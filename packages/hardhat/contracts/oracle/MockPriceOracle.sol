// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IPriceOracle } from "./IPriceOracle.sol";

/// @title MockPriceOracle
/// @notice Local/testnet stub so the vault is load-bearing without live feeds.
contract MockPriceOracle is IPriceOracle, Ownable {
    uint256 private _price;
    uint256 private _updatedAt;
    uint8 private immutable _decimals;

    event PriceSet(uint256 price, uint256 updatedAt);

    constructor(uint256 initialPrice, uint8 priceDecimals, address initialOwner) Ownable(initialOwner) {
        _decimals = priceDecimals;
        _price = initialPrice;
        _updatedAt = block.timestamp;
    }

    function setPrice(uint256 price) external onlyOwner {
        _price = price;
        _updatedAt = block.timestamp;
        emit PriceSet(price, _updatedAt);
    }

    function latestPrice() external view returns (uint256 price, uint256 updatedAt) {
        return (_price, _updatedAt);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}
