package dev.cuprum.cuprum.net.server;

import dev.cuprum.cuprum.net.NetBounds;
import dev.cuprum.cuprum.ownership.Claim;
import dev.cuprum.cuprum.ownership.ClaimAccess;
import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.AbstractContainerMenu;

/**
 * Declarative description of the feature-level guard checks a C2S payload requires (plan §3.2).
 * Built once per payload arrival by the module's <b>payload-only</b> guard-spec factory — the
 * factory receives nothing but the decoded payload, so no world/feature state can be touched
 * before the arrival gate (liveness + rate, {@code C2SGuard.checkArrival}) has passed. All
 * world-derived inputs (claim, feature state) are captured as suppliers and resolved lazily by
 * {@link C2SGuard} at their canonical step, i.e. only after every earlier step passed. Immutable.
 */
public final class GuardSpec {
    /**
     * Range check inputs: the payload-carried target position, checked against the sender's own
     * level (same-dimension by construction) and eye distance. The constructor rejects non-finite,
     * non-positive and {@code > }{@link NetBounds#MAX_RANGE_DISTANCE} bounds; the runtime check
     * fails closed on the same predicate.
     */
    public record RangeCheck(BlockPos pos, double maxDistance) {
        public RangeCheck {
            Objects.requireNonNull(pos, "pos");
            if (!NetBounds.isValidRangeDistance(maxDistance)) {
                throw new IllegalArgumentException("maxDistance must be finite, > 0 and <= "
                        + NetBounds.MAX_RANGE_DISTANCE + ": " + maxDistance);
            }
        }
    }

    /** Menu check inputs: the payload-carried container id and the expected menu class. */
    public record MenuCheck(int containerId, Class<? extends AbstractContainerMenu> menuClass) {
        public MenuCheck {
            Objects.requireNonNull(menuClass, "menuClass");
        }
    }

    /** Permission check inputs: node name plus the vanilla OP fallback level (plan D10). */
    public record PermissionCheck(String node, int fallbackOpLevel) {
        public PermissionCheck {
            Objects.requireNonNull(node, "node");
        }
    }

    /**
     * Ownership check inputs: a lazy claim resolver plus the requested access. The resolver is a
     * supplier (may return {@code null} = unclaimed) so world-derived claim/block-entity lookups
     * happen only at the OWNERSHIP step — never for payloads already rejected by an earlier
     * range/menu check, and never before the arrival gate.
     */
    public record ClaimCheck(Supplier<Claim> claimResolver, ClaimAccess access) {
        public ClaimCheck {
            Objects.requireNonNull(claimResolver, "claimResolver");
            Objects.requireNonNull(access, "access");
        }
    }

    private final RangeCheck range;
    private final MenuCheck menu;
    private final PermissionCheck permission;
    private final ClaimCheck claim;
    private final BooleanSupplier state;
    private final BooleanSupplier value;

    private GuardSpec(Builder builder) {
        this.range = builder.range;
        this.menu = builder.menu;
        this.permission = builder.permission;
        this.claim = builder.claim;
        this.state = builder.state;
        this.value = builder.value;
    }

    public static Builder builder() {
        return new Builder();
    }

    public RangeCheck range() {
        return range;
    }

    public MenuCheck menu() {
        return menu;
    }

    public PermissionCheck permission() {
        return permission;
    }

    public ClaimCheck claim() {
        return claim;
    }

    public BooleanSupplier state() {
        return state;
    }

    public BooleanSupplier value() {
        return value;
    }

    public static final class Builder {
        private RangeCheck range;
        private MenuCheck menu;
        private PermissionCheck permission;
        private ClaimCheck claim;
        private BooleanSupplier state;
        private BooleanSupplier value;

        private Builder() {
        }

        /** Target chunk loaded + eye distance within {@code maxDistance}, in the sender's level. */
        public Builder range(BlockPos pos, double maxDistance) {
            this.range = new RangeCheck(pos, maxDistance);
            return this;
        }

        /** Open menu must match the payload's container id, class, and still be valid. */
        public Builder menu(int containerId, Class<? extends AbstractContainerMenu> menuClass) {
            this.menu = new MenuCheck(containerId, menuClass);
            return this;
        }

        /** Permission node with vanilla OP fallback (evaluated in the OWNERSHIP step). */
        public Builder permission(String node, int fallbackOpLevel) {
            this.permission = new PermissionCheck(node, fallbackOpLevel);
            return this;
        }

        /**
         * Claim/ownership check. {@code claimResolver} is invoked lazily at the OWNERSHIP step
         * (after loaded/range/menu passed) and may return {@code null} for unclaimed targets.
         */
        public Builder claim(Supplier<Claim> claimResolver, ClaimAccess access) {
            this.claim = new ClaimCheck(claimResolver, access);
            return this;
        }

        /** Feature-specific state predicate; a failure is an honest race ({@code DROP_LOG}). */
        public Builder state(BooleanSupplier statePredicate) {
            this.state = Objects.requireNonNull(statePredicate, "statePredicate");
            return this;
        }

        /** Semantic value validation; a failure is a {@code VIOLATION} — reject, never clamp. */
        public Builder value(BooleanSupplier valuePredicate) {
            this.value = Objects.requireNonNull(valuePredicate, "valuePredicate");
            return this;
        }

        public GuardSpec build() {
            return new GuardSpec(this);
        }
    }
}
