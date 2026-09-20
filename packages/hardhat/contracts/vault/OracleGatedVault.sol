// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPriceOracle } from "../oracle/IPriceOracle.sol";

/// @title OracleGatedVault
/// @notice Simple deposit vault whose deposit/withdraw paths require the oracle
///         price to sit inside [minPrice, maxPrice] and be fresher than maxStaleness.
/// @dev Ecosystem integration is load-bearing: without a working oracle adapter the
///      gate always reverts. Use MockPriceOracle locally; wire Supra/Pyth adapters in docs.
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

    error PriceOutOfBand(uint256 price, uint256 minPrice, uint256 maxPrice);
    error StalePrice(uint256 updatedAt, uint256 maxStaleness);
    error ZeroAmount();
    error InsufficientBalance();

    constructor(
        address asset_,
        address oracle_,
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 maxStaleness_,
        address initialOwner
    ) Ownable(initialOwner) {
        require(asset_ != address(0) && oracle_ != address(0), "zero addr");
        require(minPrice_ <= maxPrice_, "band");
        asset = IERC20(asset_);
        oracle = IPriceOracle(oracle_);
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        maxStaleness = maxStaleness_;
    }

    function setOracle(address oracle_) external onlyOwner {
        require(oracle_ != address(0), "zero addr");
        oracle = IPriceOracle(oracle_);
        emit OracleUpdated(oracle_);
    }

    function setBand(uint256 minPrice_, uint256 maxPrice_, uint256 maxStaleness_) external onlyOwner {
        require(minPrice_ <= maxPrice_, "band");
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        maxStaleness = maxStaleness_;
        emit BandUpdated(minPrice_, maxPrice_, maxStaleness_);
    }

    /// @notice Reverts unless oracle price is in-band and fresh.
    function requirePriceInBand() public view returns (uint256 price) {
        uint256 updatedAt;
        (price, updatedAt) = oracle.latestPrice();
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxStaleness) {
            revert StalePrice(updatedAt, maxStaleness);
        }
        if (price < minPrice || price > maxPrice) {
            revert PriceOutOfBand(price, minPrice, maxPrice);
        }
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 price = requirePriceInBand();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposited(msg.sender, amount, price);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        uint256 price = requirePriceInBand();
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, price);
    }
}
