package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargePriority;
import dev.cuprum.cuprum.charge.core.Roles;
import dev.cuprum.cuprum.charge.diag.ChargeProbeReport;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Pins the MC-free {@link ChargeProbeReport} cores (plan D9 — no Minecraft imports here):
 * the exact {@code format} diagnostic line (charge.md §7; the Charge Probe, {@code /cuprum cg
 * node} and the GameTests all assert this string, so it must not drift) and the
 * {@code /cuprum cg networks} summary totals, which use
 * {@link dev.cuprum.cuprum.charge.core.ChargeMath#satAdd} and saturate at
 * {@link Long#MAX_VALUE} instead of wrapping negative (Eval-A repair F9).
 */
class ChargeProbeReportTest {
    @Test
    void formatPinsTheExactDiagnosticLine() {
        assertEquals(
                "Cg node @ 3,-12,40: stored=750/20000 Cg net=7 frozen=false roles=2 prio=LOGISTICS topo=42",
                ChargeProbeReport.format(3, -12, 40, 750L, 20_000L, 7, false, Roles.STORAGE,
                        ChargePriority.LOGISTICS, 42L));
        assertEquals(
                "Cg node @ 0,0,0: stored=0/0 Cg net=-1 frozen=true roles=9 prio=DEFENSE topo=0",
                ChargeProbeReport.format(0, 0, 0, 0L, 0L, -1, true, Roles.PRODUCER | Roles.RELAY,
                        ChargePriority.DEFENSE, 0L));
    }

    @Test
    void summarizeNetworkFormatsExactLine() {
        String line = ChargeProbeReport.summarizeNetwork(7,
                new long[]{100L, 250L},
                new long[]{1_000L, 2_000L},
                new boolean[]{false, true});
        assertEquals("Cg net=7: nodes=2 frozen=1 stored=350/3000 Cg", line);
    }

    @Test
    void summarizeNetworkSaturatesInsteadOfWrapping() {
        // Two Long.MAX_VALUE-stored nodes previously wrapped to a negative total via plain +.
        String line = ChargeProbeReport.summarizeNetwork(1,
                new long[]{Long.MAX_VALUE, Long.MAX_VALUE, 5L},
                new long[]{Long.MAX_VALUE, Long.MAX_VALUE, 10L},
                new boolean[]{false, false, false});
        assertEquals("Cg net=1: nodes=3 frozen=0 stored=" + Long.MAX_VALUE + "/" + Long.MAX_VALUE + " Cg",
                line);
    }

    @Test
    void summarizeNetworkBoundaryJustBelowSaturation() {
        String line = ChargeProbeReport.summarizeNetwork(2,
                new long[]{Long.MAX_VALUE - 1L, 1L},
                new long[]{Long.MAX_VALUE - 5L, 5L},
                new boolean[]{false, false});
        assertEquals("Cg net=2: nodes=2 frozen=0 stored=" + Long.MAX_VALUE + "/" + Long.MAX_VALUE + " Cg",
                line);
    }

    @Test
    void summarizeNetworkRejectsMismatchedColumns() {
        assertThrows(IllegalArgumentException.class, () -> ChargeProbeReport.summarizeNetwork(0,
                new long[]{1L}, new long[]{1L, 2L}, new boolean[]{false}));
    }
}
