// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Compiles Pyth's official MockPyth so tests and local deploys can exercise PythPriceOracle
// without Hermes or a live network.
import { MockPyth } from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
