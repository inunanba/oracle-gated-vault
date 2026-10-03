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

    uint8 public constant PRICE_DECIMALS = 8;

    struct AdmissionPolicy {
        uint256 price;
        uint256 observedAt;
        address source;
        uint256 minimum;
        uint256 maximum;
        uint256 freshnessWindow;
        uint256 evaluatedAt;
    }

    IERC20 public immutable asset;
    IPriceOracle public oracle;

    uint256 public minPrice;
    uint256 public maxPrice;
    uint256 public maxStaleness;

    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount, uint256 price);
    event Withdrawn(address indexed user, uint256 amount, uint256 price);
    /// @notice Immediately follows the matching action event, with the policy used before any token callback.
    event AdmissionRecorded(
        address indexed user,
        bool depositAction,
        address indexed source,
        uint256 price,
        uint256 observedAt,
        uint256 minimum,
        uint256 maximum,
        uint256 freshnessWindow,
        uint256 evaluatedAt
    );
    event OracleUpdated(address indexed oracle);
    event BandUpdated(uint256 minPrice, uint256 maxPrice, uint256 maxStaleness);
    event PriceRefreshed(address indexed caller, uint256 feePaid);

    error PriceOutOfBand(uint256 price, uint256 minPrice, uint256 maxPrice);
    error StalePrice(uint256 updatedAt, uint256 maxStaleness);
    error InvalidOracleDecimals(uint8 actual);
    error UnsupportedTransfer(uint256 expected, uint256 received);
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
        _validateOracle(oracle_);
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
        _validateOracle(oracle_);
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

    /// @notice Gate status; propagates oracle failures so callers can distinguish unavailable from closed.
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
        return _checkedPolicy().price;
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
        AdmissionPolicy memory policy = _checkedPolicy();
        balances[msg.sender] += amount;
        totalDeposits += amount;
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = asset.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert UnsupportedTransfer(amount, received);
        emit Deposited(msg.sender, amount, policy.price);
        _recordPolicy(policy, true);
    }

    function _withdraw(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender];
        if (available < amount) revert WithdrawExceedsBalance(amount, available);
        AdmissionPolicy memory policy = _checkedPolicy();
        balances[msg.sender] = available - amount;
        totalDeposits -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, policy.price);
        _recordPolicy(policy, false);
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

    function _validateOracle(address source) private view {
        uint8 actual = IPriceOracle(source).decimals();
        if (actual != PRICE_DECIMALS) revert InvalidOracleDecimals(actual);
    }

    function _checkedPolicy() private view returns (AdmissionPolicy memory policy) {
        (uint256 price, uint256 observedAt) = oracle.latestPrice();
        if (!_isFresh(observedAt)) revert StalePrice(observedAt, maxStaleness);
        if (price < minPrice || price > maxPrice) revert PriceOutOfBand(price, minPrice, maxPrice);
        policy = AdmissionPolicy(price, observedAt, address(oracle), minPrice, maxPrice, maxStaleness, block.timestamp);
    }

    function _recordPolicy(AdmissionPolicy memory policy, bool depositAction) private {
        emit AdmissionRecorded(
            msg.sender,
            depositAction,
            policy.source,
            policy.price,
            policy.observedAt,
            policy.minimum,
            policy.maximum,
            policy.freshnessWindow,
            policy.evaluatedAt
        );
    }

    function _isFresh(uint256 updatedAt) private view returns (bool) {
        return updatedAt != 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= maxStaleness;
    }
}
