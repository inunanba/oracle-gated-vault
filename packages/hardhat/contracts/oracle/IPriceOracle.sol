// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal price oracle surface used by OracleGatedVault.
/// @dev Adapters wrap Supra / Pyth (or any feed) behind this interface.
interface IPriceOracle {
    /// @return price Price with `decimals` fractional digits
    /// @return updatedAt Unix timestamp of last observation
    function latestPrice() external view returns (uint256 price, uint256 updatedAt);

    function decimals() external view returns (uint8);
}
