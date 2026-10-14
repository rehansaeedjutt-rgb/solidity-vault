// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVaultStrategy} from "./interfaces/IVaultStrategy.sol";

/// @title SimpleVault
/// @notice ERC-4626 tokenized vault with an optional strategy hook.
///
/// Behaviour without a strategy: assets sit idle. This is the safe default.
/// Behaviour with a strategy: the owner can push idle assets into the strategy
/// and pull them back. The vault never spends more than its idle balance on
/// a deploy call, and never recalls more than the strategy says it has.
///
/// Notes on design:
/// - Only the owner can change the strategy or call deploy/recall. In a real
///   product this would be behind a governance timelock; for a demo, Ownable
///   is honest about the trust assumption.
/// - `totalAssets()` counts idle + strategy-deployed. This is what the
///   ERC-4626 share price math uses.
/// - The vault does not know anything about yield. It is a bucket. A strategy
///   that actually earns yield is a separate contract.
contract SimpleVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    IVaultStrategy public strategy;

    event StrategySet(address indexed previous, address indexed next);
    event Deployed(address indexed strategy, uint256 amount);
    event Recalled(address indexed strategy, uint256 amount);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC4626(asset_) ERC20(name_, symbol_) Ownable(owner_) {}

    /// @notice Set or clear the strategy. Clearing is done by passing address(0).
    /// @dev Cannot be called while assets are deployed to the current strategy.
    ///      Recalling first is the caller's responsibility.
    function setStrategy(IVaultStrategy next) external onlyOwner {
        if (address(strategy) != address(0)) {
            require(strategy.totalDeployed() == 0, "Vault: strategy has assets deployed");
        }
        address previous = address(strategy);
        strategy = next;
        emit StrategySet(previous, address(next));
    }

    /// @notice Deploy idle assets into the strategy.
    /// @param amount Amount of underlying asset to move into the strategy.
    function deployToStrategy(uint256 amount) external onlyOwner {
        require(address(strategy) != address(0), "Vault: no strategy set");
        require(amount > 0, "Vault: amount must be > 0");

        IERC20 asset_ = IERC20(asset());
        uint256 idle = asset_.balanceOf(address(this));
        require(amount <= idle, "Vault: insufficient idle balance");

        // Approve and call. The strategy is expected to pull.
        asset_.forceApprove(address(strategy), amount);
        uint256 deployed = strategy.deploy(amount);
        require(deployed <= amount, "Vault: strategy deployed more than asked");
        emit Deployed(address(strategy), deployed);
    }

    /// @notice Recall assets from the strategy back into the vault.
    /// @param amount Amount of underlying asset to recall.
    function recallFromStrategy(uint256 amount) external onlyOwner {
        require(address(strategy) != address(0), "Vault: no strategy set");
        require(amount > 0, "Vault: amount must be > 0");

        uint256 recalled = strategy.recall(amount);
        require(recalled <= amount, "Vault: strategy recalled more than asked");
        emit Recalled(address(strategy), recalled);
    }

    /// @inheritdoc ERC4626
    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (address(strategy) == address(0)) {
            return idle;
        }
        return idle + strategy.totalDeployed();
    }
}