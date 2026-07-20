package dev.cuprum.cuprum.multiblock;

import com.google.gson.JsonElement;
import com.mojang.datafixers.util.Pair;
import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.Decoder;
import com.mojang.serialization.DynamicOps;
import com.mojang.serialization.JsonOps;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Vec3i;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.StringRepresentable;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

/**
 * One declarative multiblock pattern (multiblock.md §3, frozen). Parsed strictly from
 * {@code data/<ns>/cuprum_multiblock/<id>.json} via {@link #CODEC} ({@code Codec.validate}
 * runs the {@link PatternShape} rules with precise error messages); matched anchored at the
 * controller position — never a volume scan (§3.3): per orientation at most
 * {@link #memberCount()} reads, each guarded by {@code level.isLoaded(pos)}.
 *
 * <p>Vanilla {@code BlockPattern} is deliberately NOT used (§3.4): it volume-scans, has no
 * anchor/controller notion, no JSON form, no fault reporting, and its {@code BlockInWorld}
 * caching can touch unloaded chunks.
 */
public final class MultiblockPattern {
    public static final int MAX_DIMENSION = PatternShape.MAX_DIMENSION;
    public static final int MAX_CELLS = PatternShape.MAX_CELLS;
    public static final int MAX_KEY_ENTRIES = PatternShape.MAX_KEY_ENTRIES;
    public static final int FORMAT_VERSION = 1;

    /** How candidate orientations are searched (§3.1, frozen). */
    public enum OrientationMode implements StringRepresentable {
        /** Search 4 rotations (× mirror when {@code allow_mirror}). */
        ANY_HORIZONTAL("any_horizontal"),
        /** Orientation comes from the controller state's {@code facing}; mirror still searched. */
        CONTROLLER_FACING("controller_facing");

        public static final Codec<OrientationMode> CODEC = StringRepresentable.fromEnum(OrientationMode::values);

        private final String id;

        OrientationMode(String id) {
            this.id = id;
        }

        @Override
        public String getSerializedName() {
            return id;
        }
    }

    private record Raw(int formatVersion, OrientationMode orientationMode, boolean allowMirror,
                       List<List<String>> layers, Map<String, BlockMatcher> key, String controller) {
        private static final Codec<Raw> STRUCTURED_CODEC = RecordCodecBuilder.create(instance -> instance.group(
                Codec.INT.fieldOf("format_version").forGetter(Raw::formatVersion),
                OrientationMode.CODEC.fieldOf("orientation_mode").forGetter(Raw::orientationMode),
                Codec.BOOL.fieldOf("allow_mirror").forGetter(Raw::allowMirror),
                Codec.list(Codec.list(Codec.STRING)).fieldOf("layers").forGetter(Raw::layers),
                Codec.unboundedMap(Codec.STRING, BlockMatcher.CODEC).fieldOf("key").forGetter(Raw::key),
                Codec.STRING.fieldOf("controller").forGetter(Raw::controller)
        ).apply(instance, Raw::new));

        /**
         * Decode-only raw gate: convert the untouched input to JsonOps, validate its exact
         * shape and bounds, and only then let collection codecs allocate their results.
         */
        private static final Decoder<Raw> STRICT_DECODER = new Decoder<>() {
            @Override
            public <T> DataResult<Pair<Raw, T>> decode(DynamicOps<T> ops, T input) {
                JsonElement json = ops.convertTo(JsonOps.INSTANCE, input);
                return MultiblockPatternJson.validate(json)
                        .flatMap(ignored -> STRUCTURED_CODEC.decode(ops, input));
            }
        };

        static final Codec<Raw> CODEC = Codec.of(STRUCTURED_CODEC, STRICT_DECODER);
    }

    /** Strict schema codec: {@code Codec.validate} runs the frozen §3.1 rules (compile probe 7). */
    public static final Codec<MultiblockPattern> CODEC = Raw.CODEC.validate(raw -> {
        if (raw.formatVersion() != FORMAT_VERSION) {
            return DataResult.error(() -> "unsupported format_version " + raw.formatVersion()
                    + "; expected " + FORMAT_VERSION);
        }
        try {
            PatternShape.analyze(raw.layers(), raw.key().keySet(), raw.controller());
        } catch (IllegalArgumentException e) {
            return DataResult.error(e::getMessage);
        }
        return DataResult.success(raw);
    }).xmap(MultiblockPattern::new, pattern -> pattern.raw);

    private final Raw raw;
    private final PatternShape shape;
    private ResourceLocation id;

    /** Package-private read hook used only by permanent GameTest budget assertions. */
    @FunctionalInterface
    interface CellReadObserver {
        void onRead(MultiblockOrientation orientation, BlockPos position);
    }

    private MultiblockPattern(Raw raw) {
        this.raw = raw;
        this.shape = PatternShape.analyze(raw.layers(), raw.key().keySet(), raw.controller());
    }

    /** Bound once by the {@link MultiblockPatterns} reloader; a pattern is unusable before. */
    void bindId(ResourceLocation id) {
        this.id = id;
    }

    /** The data-file id; throws if the pattern never went through the reloader. */
    public ResourceLocation id() {
        if (id == null) {
            throw new IllegalStateException("MultiblockPattern id not bound (must load through MultiblockPatterns)");
        }
        return id;
    }

    public int sizeX() {
        return shape.sizeX();
    }

    public int sizeY() {
        return shape.sizeY();
    }

    public int sizeZ() {
        return shape.sizeZ();
    }

    /** The controller cell in pattern-local coordinates. */
    public Vec3i controllerCell() {
        PatternShape.Cell cell = shape.controllerCell();
        return new Vec3i(cell.x(), cell.y(), cell.z());
    }

    /** Non-ignored cells, controller included. */
    public int memberCount() {
        return shape.memberCount();
    }

    /**
     * Anchored match at {@code controllerPos} (§3.3): tries each candidate orientation in
     * canonical order; at most {@link #memberCount()} guarded reads per orientation; an
     * unloaded member short-circuits the orientation with {@link FaultCode#UNLOADED}. On
     * failure the best fault comes from the orientation with the most matched cells (tie →
     * earlier canonical order).
     */
    public MultiblockMatchResult tryMatch(ServerLevel level, BlockPos controllerPos) {
        return tryMatch(level, controllerPos, null);
    }

    /**
     * Test-observable implementation; the observer runs immediately before each guarded
     * member-state read and is never called for an unloaded cell.
     */
    MultiblockMatchResult tryMatch(
            ServerLevel level, BlockPos controllerPos, CellReadObserver readObserver) {
        ResourceLocation boundId = id();
        List<MultiblockOrientation> candidates;
        if (raw.orientationMode() == OrientationMode.ANY_HORIZONTAL) {
            candidates = raw.allowMirror()
                    ? MultiblockOrientation.HORIZONTAL_ALL
                    : MultiblockOrientation.HORIZONTAL_UNMIRRORED;
        } else {
            Candidates resolved = controllerFacingOrientations(level, controllerPos);
            if (resolved.failure() != null) {
                return resolved.failure();
            }
            candidates = resolved.orientations();
        }

        Vec3i controllerCell = controllerCell();
        MultiblockFault bestFault = null;
        int bestMatched = -1;
        for (MultiblockOrientation orientation : candidates) {
            long[] members = new long[shape.memberCount()];
            int matched = 0;
            MultiblockFault fault = null;
            int memberIndex = 0;
            for (PatternShape.Cell cell : shape.memberCells()) {
                Vec3i localOffset = new Vec3i(cell.x() - controllerCell.getX(),
                        cell.y() - controllerCell.getY(), cell.z() - controllerCell.getZ());
                BlockPos worldPos = controllerPos.offset(orientation.transformOffset(localOffset));
                members[memberIndex++] = worldPos.asLong();
                if (!level.isLoaded(worldPos)) {
                    fault = new MultiblockFault(FaultCode.UNLOADED, Optional.of(worldPos),
                            "member chunk not loaded");
                    break;
                }
                BlockMatcher matcher = raw.key().get(cell.key());
                if (readObserver != null) {
                    readObserver.onRead(orientation, worldPos);
                }
                if (!matcher.matches(level.getBlockState(worldPos), orientation)) {
                    if (fault == null) {
                        fault = new MultiblockFault(FaultCode.MISMATCH, Optional.of(worldPos),
                                "cell '" + cell.key() + "' does not match");
                    }
                    continue;
                }
                matched++;
            }
            if (fault == null) {
                Arrays.sort(members);
                return MultiblockMatchResult.success(new MultiblockMatch(boundId, orientation, members));
            }
            if (matched > bestMatched) {
                bestMatched = matched;
                bestFault = fault;
            }
        }
        return MultiblockMatchResult.failure(bestFault);
    }

    /** Resolved CONTROLLER_FACING candidates, or the failure result when unresolvable. */
    private record Candidates(List<MultiblockOrientation> orientations, MultiblockMatchResult failure) {
    }

    /**
     * Resolves CONTROLLER_FACING candidates from the controller state's horizontal
     * {@code facing} property; mirror is still searched when {@code allow_mirror} (§3.1).
     */
    private Candidates controllerFacingOrientations(ServerLevel level, BlockPos controllerPos) {
        if (!level.isLoaded(controllerPos)) {
            return new Candidates(List.of(), MultiblockMatchResult.failure(new MultiblockFault(
                    FaultCode.UNLOADED, Optional.of(controllerPos), "controller chunk not loaded")));
        }
        BlockState state = level.getBlockState(controllerPos);
        Property<?> property = state.getBlock().getStateDefinition().getProperty(BlockMatcher.FACING_PROPERTY);
        Direction facing = null;
        if (property != null && state.getValue(property) instanceof Direction direction) {
            facing = direction;
        }
        if (facing == null || facing.getAxis().isVertical()) {
            return new Candidates(List.of(), MultiblockMatchResult.failure(new MultiblockFault(
                    FaultCode.MISMATCH, Optional.of(controllerPos),
                    "controller has no horizontal 'facing' property")));
        }
        Rotation rotation = switch (facing) {
            case NORTH -> Rotation.NONE;
            case EAST -> Rotation.CLOCKWISE_90;
            case SOUTH -> Rotation.CLOCKWISE_180;
            default -> Rotation.COUNTERCLOCKWISE_90; // WEST
        };
        List<MultiblockOrientation> orientations = raw.allowMirror()
                ? List.of(new MultiblockOrientation(rotation, Mirror.NONE),
                        new MultiblockOrientation(rotation, Mirror.LEFT_RIGHT))
                : List.of(new MultiblockOrientation(rotation, Mirror.NONE));
        return new Candidates(orientations, null);
    }

    /**
     * Pure geometry: every member position (controller included) for a controller at
     * {@code controllerPos} under {@code orientation}, as sorted {@code BlockPos.asLong} keys.
     * No world reads — used for the provisional claim re-registration on load (§5.1 rule 2).
     */
    public long[] memberPositions(BlockPos controllerPos, MultiblockOrientation orientation) {
        Vec3i controllerCell = controllerCell();
        long[] members = new long[shape.memberCount()];
        int i = 0;
        for (PatternShape.Cell cell : shape.memberCells()) {
            Vec3i localOffset = new Vec3i(cell.x() - controllerCell.getX(),
                    cell.y() - controllerCell.getY(), cell.z() - controllerCell.getZ());
            members[i++] = controllerPos.offset(orientation.transformOffset(localOffset)).asLong();
        }
        Arrays.sort(members);
        return members;
    }

    /** Pattern-local display state for a key char; empty for tag matchers (test builder). */
    public Optional<BlockState> displayState(char key) {
        BlockMatcher matcher = raw.key().get(String.valueOf(key));
        return matcher == null ? Optional.empty() : matcher.displayState();
    }

    /** The matcher key char of the pattern cell at local (x, y, z); {@code "."} when ignored. */
    public String cellKey(int x, int y, int z) {
        for (PatternShape.Cell cell : shape.memberCells()) {
            if (cell.x() == x && cell.y() == y && cell.z() == z) {
                return cell.key();
            }
        }
        return PatternShape.IGNORED_CELL;
    }
}
