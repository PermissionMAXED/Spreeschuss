package dev.cuprum.cuprum.multiblock;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import java.util.Map;
import java.util.Optional;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

/**
 * One pattern-key matcher (multiblock.md §3.1, frozen rules): exactly one of {@code block}
 * (registry {@code byNameCodec} — unknown ids fail parse) or {@code tag}; an optional
 * {@code state} map of property-name → value-string (textual match against
 * {@code Property.getName(value)}; unknown property/value rejects the resource); an optional
 * {@code facing} — the ONLY rotation/mirror-aware check (the expected value is transformed by
 * the orientation first). Tag matchers deliberately reject state/facing constraints because
 * validating one constraint against every block resolved by a reloadable tag is not safe in
 * this registry-ops-free loader. No RegistryOps-dependent codecs, so the plain-{@code JsonOps}
 * reloader constructor works.
 */
public record BlockMatcher(Optional<Block> block, Optional<TagKey<Block>> tag,
                           Map<String, String> state, Optional<Direction> facing) {
    /** The block-state property name checked by the {@code facing} matcher. */
    public static final String FACING_PROPERTY = "facing";

    public static final Codec<BlockMatcher> CODEC = RecordCodecBuilder.<BlockMatcher>create(instance -> instance.group(
            BuiltInRegistries.BLOCK.byNameCodec().optionalFieldOf("block").forGetter(BlockMatcher::block),
            TagKey.codec(Registries.BLOCK).optionalFieldOf("tag").forGetter(BlockMatcher::tag),
            Codec.unboundedMap(Codec.STRING, Codec.STRING).optionalFieldOf("state", Map.of())
                    .forGetter(BlockMatcher::state),
            Direction.CODEC.optionalFieldOf("facing").forGetter(BlockMatcher::facing)
    ).apply(instance, BlockMatcher::new)).validate(BlockMatcher::validate);

    private static DataResult<BlockMatcher> validate(BlockMatcher matcher) {
        if (matcher.block().isPresent() == matcher.tag().isPresent()) {
            return DataResult.error(() -> "matcher must define exactly one of 'block' or 'tag'");
        }
        if (matcher.state().size() > MultiblockPatternJson.MAX_STATE_ENTRIES) {
            return DataResult.error(() -> "matcher state defines " + matcher.state().size()
                    + " entries; max " + MultiblockPatternJson.MAX_STATE_ENTRIES);
        }
        if (matcher.tag().isPresent() && (!matcher.state().isEmpty() || matcher.facing().isPresent())) {
            return DataResult.error(() ->
                    "tag matcher with state/facing constraints is unsupported; use an exact block matcher");
        }
        if (matcher.facing().isPresent() && matcher.state().containsKey(FACING_PROPERTY)) {
            return DataResult.error(() -> "matcher cannot define 'facing' in both state and facing");
        }
        if (matcher.block().isPresent()) {
            Block block = matcher.block().get();
            for (Map.Entry<String, String> entry : matcher.state().entrySet()) {
                DataResult<BlockMatcher> error = validateProperty(block, entry.getKey(), entry.getValue());
                if (error != null) {
                    return error;
                }
            }
            if (matcher.facing().isPresent()) {
                DataResult<BlockMatcher> error = validateProperty(
                        block, FACING_PROPERTY, matcher.facing().get().getSerializedName());
                if (error != null) {
                    return error;
                }
            }
        }
        return DataResult.success(matcher);
    }

    private static DataResult<BlockMatcher> validateProperty(Block block, String propertyName, String valueName) {
        Property<?> property = block.getStateDefinition().getProperty(propertyName);
        if (property == null) {
            return DataResult.error(() -> "block " + BuiltInRegistries.BLOCK.getKey(block)
                    + " has no state property '" + propertyName + "'");
        }
        if (property.getValue(valueName).isEmpty()) {
            return DataResult.error(() -> "block " + BuiltInRegistries.BLOCK.getKey(block)
                    + " property '" + propertyName + "' has no value '" + valueName + "'");
        }
        return null;
    }

    public BlockMatcher {
        state = Map.copyOf(state);
    }

    /** Whether {@code observed} satisfies this matcher under {@code orientation} (§3.1). */
    public boolean matches(BlockState observed, MultiblockOrientation orientation) {
        if (block.isPresent()) {
            if (!observed.is(block.get())) {
                return false;
            }
        } else if (!observed.is(tag.orElseThrow())) {
            return false;
        }
        for (Map.Entry<String, String> entry : state.entrySet()) {
            if (!propertyValueEquals(observed, entry.getKey(), entry.getValue())) {
                return false;
            }
        }
        if (facing.isPresent()) {
            Direction expected = orientation.transformFacing(facing.get());
            return propertyValueEquals(observed, FACING_PROPERTY, expected.getSerializedName());
        }
        return true;
    }

    /**
     * The pattern-local display state for exact-block matchers (test builder / future
     * previews); empty for tag matchers. State/facing entries are guaranteed valid by the
     * resource codec.
     */
    public Optional<BlockState> displayState() {
        return block.map(value -> {
            BlockState display = value.defaultBlockState();
            for (Map.Entry<String, String> entry : state.entrySet()) {
                display = withProperty(display, entry.getKey(), entry.getValue());
            }
            if (facing.isPresent()) {
                display = withProperty(display, FACING_PROPERTY, facing.get().getSerializedName());
            }
            return display;
        });
    }

    private static boolean propertyValueEquals(BlockState observed, String propertyName, String expectedValueName) {
        Property<?> property = observed.getBlock().getStateDefinition().getProperty(propertyName);
        return property != null && valueName(observed, property).equals(expectedValueName);
    }

    private static <T extends Comparable<T>> String valueName(BlockState observed, Property<T> property) {
        return property.getName(observed.getValue(property));
    }

    private static BlockState withProperty(BlockState display, String propertyName, String valueName) {
        Property<?> property = display.getBlock().getStateDefinition().getProperty(propertyName);
        return property == null ? display : setValue(display, property, valueName);
    }

    private static <T extends Comparable<T>> BlockState setValue(BlockState display, Property<T> property,
            String valueName) {
        return property.getValue(valueName).map(value -> display.setValue(property, value)).orElse(display);
    }
}
