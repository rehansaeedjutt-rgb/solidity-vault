// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IVaultStrategy
/// @notice Minimal strategy interface. A vault delegates asset deployment to
/// a strategy that implements this interface. Kept tiny on purpose — the
/// bigger the interface, the more room for strategy-specific bugs.
interface IVaultStrategy {
    /// @notice Deploy assets. Vault transfers `amount` before calling this.
    /// @return deployed Amount of assets successfully deployed.
    function deploy(uint256 amount) external returns (uint256 deployed);

    /// @notice Recall assets. Strategy transfers `amount` back to the vault.
    /// @return recalled Amount actually returned.
    function recall(uint256 amount) external returns (uint256 recalled);

    /// @notice Total assets currently under the strategy's control.
    function totalDeployed() external view returns (uint256);
}