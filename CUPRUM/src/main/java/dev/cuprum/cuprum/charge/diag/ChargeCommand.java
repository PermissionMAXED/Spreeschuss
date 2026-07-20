package dev.cuprum.cuprum.charge.diag;

import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.NodeReport;
import dev.cuprum.cuprum.charge.core.GraphDiagnosticsSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;

/**
 * {@code /cuprum cg stats|networks|node <pos>} (charge.md §6): read-only graph diagnostics for
 * the command source's own dimension. Gated {@code Commands.hasPermission(2)} — the vanilla
 * fallback for the reserved {@code cuprum.diagnostics} permission node (plan D10: the external
 * provider bridge is a later drop-in). Purely in-memory: never loads chunks — {@code node} on
 * an unregistered/unloaded position simply reports no node.
 */
public final class ChargeCommand {
    private ChargeCommand() {
    }

    public static void register() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
                dispatcher.register(Commands.literal("cuprum")
                        .then(Commands.literal("cg")
                                .requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
                                .then(Commands.literal("stats").executes(context -> stats(context.getSource())))
                                .then(Commands.literal("networks").executes(context -> networks(context.getSource())))
                                .then(Commands.literal("node")
                                        .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                                .executes(context -> node(context.getSource(),
                                                        BlockPosArgument.getBlockPos(context, "pos"))))))));
    }

    private static int stats(CommandSourceStack source) {
        GraphDiagnosticsSnapshot snapshot = ChargeGraphManager.of(source.getLevel()).diagnostics();
        source.sendSuccess(() -> Component.literal(
                "Cg stats: nodes=" + snapshot.nodes() + " edges=" + snapshot.edges()
                        + " networks=" + snapshot.networks() + " frozen=" + snapshot.frozenNodes()
                        + " topo=" + snapshot.topologyVersion()
                        + " moved=" + snapshot.movedLastTick()
                        + " vented=" + snapshot.ventedLastTick() + "/" + snapshot.ventedTotal()
                        + " tickNs=" + snapshot.tickNanosLast() + " (ema " + snapshot.tickNanosEma() + ")"
                        + " rebuildQueue=" + snapshot.rebuildQueueDepth()), false);
        return 1;
    }

    private static int networks(CommandSourceStack source) {
        Map<Integer, List<NodeReport>> networks = ChargeGraphManager.of(source.getLevel()).networkReports();
        if (networks.isEmpty()) {
            source.sendSuccess(() -> Component.literal("Cg networks: none"), false);
            return 0;
        }
        for (Map.Entry<Integer, List<NodeReport>> network : networks.entrySet()) {
            // Saturating totals (Eval-A repair): summarizeNetwork uses ChargeMath.satAdd so
            // stored/capacity sums can never wrap negative.
            String line = ChargeProbeReport.summarizeNetwork(network.getKey(), network.getValue());
            source.sendSuccess(() -> Component.literal(line), false);
        }
        return networks.size();
    }

    private static int node(CommandSourceStack source, BlockPos pos) {
        Optional<NodeReport> report = ChargeGraphManager.of(source.getLevel()).nodeReport(pos);
        if (report.isEmpty()) {
            source.sendFailure(Component.literal(
                    "No Cg node at " + pos.getX() + "," + pos.getY() + "," + pos.getZ()));
            return 0;
        }
        source.sendSuccess(() -> Component.literal(ChargeProbeReport.format(report.get())), false);
        return 1;
    }
}
