// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IPriceOracle } from "./IPriceOracle.sol";

/// @notice Extension for pull-based oracles (Pyth, Supra pull) that need a signed
///         price update pushed on-chain before the price can be read.
interface IUpdatablePriceOracle is IPriceOracle {
    /// @return fee Fee in the native unit the EVM sees (tinybars on Hedera).
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 fee);

    /// @notice Verifies and stores `updateData`. Caller must send exactly `getUpdateFee(updateData)`.
    function updatePrice(bytes[] calldata updateData) external payable;
}
