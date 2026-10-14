// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultStrategy} from "../interfaces/IVaultStrategy.sol";

/// @title MockStrategy
/// @notice Holds assets without earning anything by default. Exists so the
/// vault's deploy/recall paths can be tested without a real DeFi integration.
///
/// A yield knob is available for tests that need to observe a rising share
/// price. It is not a yield source, it is a test fixture.
contract MockStrategy is IVaultStrategy {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    address public immutable vault;
    uint256 private _deployed;

    constructor(IERC20 asset_, address vault_) {
        asset = asset_;
        vault = vault_;
    }

    /// @inheritdoc IVaultStrategy
    function deploy(uint256 amount) external override returns (uint256) {
        require(msg.sender == vault, "MockStrategy: only vault");
        asset.safeTransferFrom(vault, address(this), amount);
        _deployed += amount;
        return amount;
    }

    /// @inheritdoc IVaultStrategy
    function recall(uint256 amount) external override returns (uint256) {
        require(msg.sender == vault, "MockStrategy: only vault");
        uint256 available = _deployed;
        uint256 toReturn = amount > available ? available : amount;
        asset.safeTransfer(vault, toReturn);
        _deployed -= toReturn;
        return toReturn;
    }

    /// @inheritdoc IVaultStrategy
    function totalDeployed() external view override returns (uint256) {
        return _deployed;
    }

    /// @notice Test-only: simulate the strategy earning yield by manually
    /// increasing the tracked deployed amount. The caller is expected to
    /// have transferred the extra assets here first.
    function simulateYield(uint256 amount) external {
        _deployed += amount;
    }
}