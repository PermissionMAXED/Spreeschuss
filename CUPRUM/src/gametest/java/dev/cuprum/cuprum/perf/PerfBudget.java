package dev.cuprum.cuprum.perf;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/**
 * The perf gate + canonical JSON report writer (handbook-config.md §9). Every gated test
 * calls {@link #assertMeanBelow}: it computes min/mean/p95/max over the post-warmup
 * samples, writes {@code build/perf/<test>.json} (CI-uploaded artifact) and hard-fails the
 * test when the mean exceeds the budget. Report keys are emitted in one fixed order and
 * values are integral nanoseconds — byte-stable for identical inputs.
 *
 * <p>The report directory resolves to the project's {@code build/perf}: Loom run tasks set
 * {@code user.dir} to {@code build/run/<task>}, so the writer ascends to the enclosing
 * {@code build} directory; a plain JVM (unit test, future harness script) writes to
 * {@code ./build/perf}. Override with {@code -Dcuprum.perfDir=<abs path>} if ever needed.
 */
public final class PerfBudget {
    /** One evaluated gate; {@code meanNs} is rounded to whole nanoseconds for stable JSON. */
    public record Result(String test, int samples, long minNs, long meanNs, long p95Ns,
            long maxNs, long budgetNs, boolean pass) {
    }

    private PerfBudget() {
    }

    /**
     * Evaluates + reports + gates in one step. Returns the result so tests can log it.
     *
     * @throws AssertionError when there are no measured samples or the mean exceeds budget
     */
    public static Result assertMeanBelow(PerfSampler sampler, String test, long budgetNs,
            int warmupSamples) {
        List<Long> samples = sampler.measuredSamples(warmupSamples);
        if (samples.isEmpty()) {
            throw new AssertionError("perf gate '" + test + "' collected no measured samples");
        }
        List<Long> sorted = samples.stream().sorted().toList();
        long min = sorted.get(0);
        long max = sorted.get(sorted.size() - 1);
        long p95 = sorted.get(Math.min(sorted.size() - 1, (int) Math.ceil(sorted.size() * 0.95) - 1));
        double mean = samples.stream().mapToLong(Long::longValue).average().orElseThrow();
        Result result = new Result(test, samples.size(), min, Math.round(mean), p95, max,
                budgetNs, mean <= budgetNs);
        writeReport(result);
        if (!result.pass()) {
            throw new AssertionError(String.format(Locale.ROOT,
                    "perf gate '%s' failed: mean %.3f ms > budget %.3f ms over %d samples",
                    test, mean / 1.0e6, budgetNs / 1.0e6, samples.size()));
        }
        return result;
    }

    /** Canonical fixed-key-order JSON at {@code <perfDir>/<test>.json}. */
    public static void writeReport(Result result) {
        String json = String.format(Locale.ROOT,
                "{\"test\":\"%s\",\"samples\":%d,\"min_ns\":%d,\"mean_ns\":%d,"
                        + "\"p95_ns\":%d,\"max_ns\":%d,\"budget_ns\":%d,\"pass\":%s}\n",
                result.test(), result.samples(), result.minNs(), result.meanNs(),
                result.p95Ns(), result.maxNs(), result.budgetNs(), result.pass());
        try {
            Path dir = reportDir();
            Files.createDirectories(dir);
            Files.writeString(dir.resolve(result.test() + ".json"), json, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("could not write perf report for " + result.test(), e);
        }
    }

    static Path reportDir() {
        String override = System.getProperty("cuprum.perfDir");
        if (override != null && !override.isBlank()) {
            return Path.of(override);
        }
        // Loom run tasks execute inside <project>/build/run/<task>: ascend to build/.
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate = cwd; candidate != null; candidate = candidate.getParent()) {
            if ("build".equals(String.valueOf(candidate.getFileName()))) {
                return candidate.resolve("perf");
            }
        }
        return cwd.resolve("build").resolve("perf");
    }
}
