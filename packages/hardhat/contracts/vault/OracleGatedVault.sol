// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { IPriceOracle } from "../oracle/IPriceOracle.sol";
import { IUpdatablePriceOracle } from "../oracle/IUpdatablePriceOracle.sol";

/// @title OracleGatedVault
/// @notice ERC-20 vault whose deposit and withdraw paths only open while the oracle price
///         is inside [minPrice, maxPrice] and no older than maxStaleness seconds.
/// @dev The oracle is load-bearing: with no fresh in-band price every state-changing user call
///      reverts. `*WithPriceUpdate` variants let the caller post a pull-oracle update (Pyth/Supra)
///      and act on it in the same transaction.
contract OracleGatedVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    IPriceOracle public oracle;

    uint256 public minPrice;
    uint256 public maxPrice;
    uint256 public maxStaleness;

    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount, uint256 price);
    event Withdrawn(address indexed user, uint256 amount, uint256 price);
    event OracleUpdated(address indexed oracle);
    event BandUpdated(uint256 minPrice, uint256 maxPrice, uint256 maxStaleness);
    event PriceRefreshed(address indexed caller, uint256 feePaid);

    error PriceOutOfBand(uint256 price, uint256 minPrice, uint256 maxPrice);
    error StalePrice(uint256 updatedAt, uint256 maxStaleness);
    error ZeroAmount();
    error ZeroAddress();
    error InvalidBand(uint256 minPrice, uint256 maxPrice);
    error WithdrawExceedsBalance(uint256 requested, uint256 available);
    error InsufficientUpdateFee(uint256 sent, uint256 required);
    error UnexpectedValue();

    constructor(
        address asset_,
        address oracle_,
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 maxStaleness_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (asset_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        if (minPrice_ > maxPrice_) revert InvalidBand(minPrice_, maxPrice_);
        asset = IERC20(asset_);
        oracle = IPriceOracle(oracle_);
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        maxStaleness = maxStaleness_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = IPriceOracle(oracle_);
        emit OracleUpdated(oracle_);
    }

    function setBand(uint256 minPrice_, uint256 maxPrice_, uint256 maxStaleness_) external onlyOwner {
        if (minPrice_ > maxPrice_) revert InvalidBand(minPrice_, maxPrice_);
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        maxStaleness = maxStaleness_;
        emit BandUpdated(minPrice_, maxPrice_, maxStaleness_);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Non-reverting gate status for frontends and scripts.
    function previewGate() external view returns (uint256 price, uint256 updatedAt, bool fresh, bool inBand) {
        (price, updatedAt) = oracle.latestPrice();
        fresh = _isFresh(updatedAt);
        inBand = price >= minPrice && price <= maxPrice;
    }

    /// @notice Fee (native EVM unit; tinybars on Hedera) to post `updateData` through the oracle.
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256) {
        return IUpdatablePriceOracle(address(oracle)).getUpdateFee(updateData);
    }

    /// @notice Reverts unless the oracle price is fresh and in band.
    function requirePriceInBand() public view returns (uint256 price) {
        uint256 updatedAt;
        (price, updatedAt) = oracle.latestPrice();
        if (!_isFresh(updatedAt)) revert StalePrice(updatedAt, maxStaleness);
        if (price < minPrice || price > maxPrice) revert PriceOutOfBand(price, minPrice, maxPrice);
    }

    // ---------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------

    /// @notice Deposit using the price already stored in the oracle.
    function deposit(uint256 amount) external nonReentrant {
        _deposit(amount);
    }

    /// @notice Post a pull-oracle update, then deposit. Excess value is refunded.
    function depositWithPriceUpdate(uint256 amount, bytes[] calldata priceUpdate) external payable nonReentrant {
        _refreshPrice(priceUpdate);
        _deposit(amount);
    }

    /// @notice Withdraw using the price already stored in the oracle.
    function withdraw(uint256 amount) external nonReentrant {
        _withdraw(amount);
    }

    /// @notice Post a pull-oracle update, then withdraw. Excess value is refunded.
    function withdrawWithPriceUpdate(uint256 amount, bytes[] calldata priceUpdate) external payable nonReentrant {
        _refreshPrice(priceUpdate);
        _withdraw(amount);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _deposit(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 price = requirePriceInBand();
        balances[msg.sender] += amount;
        totalDeposits += amount;
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, price);
    }

    function _withdraw(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender];
        if (available < amount) revert WithdrawExceedsBalance(amount, available);
        uint256 price = requirePriceInBand();
        balances[msg.sender] = available - amount;
        totalDeposits -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, price);
    }

    function _refreshPrice(bytes[] calldata priceUpdate) private {
        if (priceUpdate.length == 0) {
            if (msg.value != 0) revert UnexpectedValue();
            return;
        }
        IUpdatablePriceOracle updatable = IUpdatablePriceOracle(address(oracle));
        uint256 fee = updatable.getUpdateFee(priceUpdate);
        if (msg.value < fee) revert InsufficientUpdateFee(msg.value, fee);
        updatable.updatePrice{ value: fee }(priceUpdate);
        emit PriceRefreshed(msg.sender, fee);
        if (msg.value > fee) Address.sendValue(payable(msg.sender), msg.value - fee);
    }

    function _isFresh(uint256 updatedAt) private view returns (bool) {
        return updatedAt >= block.timestamp || block.timestamp - updatedAt <= maxStaleness;
    }
}
