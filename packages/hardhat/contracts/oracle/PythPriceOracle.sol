// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import { IUpdatablePriceOracle } from "./IUpdatablePriceOracle.sol";

/// @title PythPriceOracle
/// @notice Adapts one Pyth price feed to the vault's IPriceOracle surface.
/// @dev Pyth on Hedera is pull-based: the latest signed price lives off-chain in Hermes and
///      must be posted with `updatePrice` (paying Pyth's update fee) before it is fresh on-chain.
///      Freshness is enforced by the consumer (OracleGatedVault.maxStaleness); this adapter
///      normalises the exponent and rejects non-positive or overly uncertain prices.
contract PythPriceOracle is IUpdatablePriceOracle {
    uint256 private constant BPS = 10_000;

    IPyth public immutable pyth;
    bytes32 public immutable priceId;
    uint8 private immutable _decimals;
    /// @notice Max allowed confidence interval as basis points of price (e.g. 200 = 2%).
    uint256 public immutable maxConfidenceBps;

    error NonPositivePrice(int64 price);
    error ConfidenceTooWide(uint64 conf, uint256 price);
    error ExponentOutOfRange(int32 expo);
    error IncorrectUpdateFee(uint256 sent, uint256 required);

    constructor(address pyth_, bytes32 priceId_, uint8 decimals_, uint256 maxConfidenceBps_) {
        pyth = IPyth(pyth_);
        priceId = priceId_;
        _decimals = decimals_;
        maxConfidenceBps = maxConfidenceBps_;
    }

    /// @inheritdoc IUpdatablePriceOracle
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256) {
        return pyth.getUpdateFee(updateData);
    }

    /// @inheritdoc IUpdatablePriceOracle
    function updatePrice(bytes[] calldata updateData) external payable {
        uint256 fee = pyth.getUpdateFee(updateData);
        if (msg.value != fee) revert IncorrectUpdateFee(msg.value, fee);
        pyth.updatePriceFeeds{ value: fee }(updateData);
    }

    /// @notice Latest stored price scaled to `decimals()`; `updatedAt` is Pyth's publishTime.
    function latestPrice() external view returns (uint256 price, uint256 updatedAt) {
        PythStructs.Price memory p = pyth.getPriceUnsafe(priceId);
        if (p.price <= 0) revert NonPositivePrice(p.price);

        price = _scale(uint256(uint64(p.price)), p.expo);
        uint256 conf = _scale(uint256(p.conf), p.expo);
        if (conf * BPS > price * maxConfidenceBps) revert ConfidenceTooWide(p.conf, price);

        updatedAt = p.publishTime;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @dev Converts value * 10^expo into a fixed-point number with `_decimals` digits.
    function _scale(uint256 value, int32 expo) private view returns (uint256) {
        if (expo > 0 || expo < -18) revert ExponentOutOfRange(expo);
        uint256 fromDecimals = uint256(uint32(-expo));
        if (fromDecimals == _decimals) return value;
        if (fromDecimals > _decimals) return value / 10 ** (fromDecimals - _decimals);
        return value * 10 ** (_decimals - fromDecimals);
    }
}
