package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Validates catalog/catalog.json against catalog/schema.json plus semantic rules that a
 * JSON schema cannot express:
 *
 * <ul>
 *   <li>binding one-to-one U-id → contract mapping ({@link UserContracts}): exact
 *       contract_key, canonical name and family per id;</li>
 *   <li>origin/id-shape consistency (U ids are user entries, family ids like PWR-01 are
 *       additional entries; contract_key required for user, forbidden for additional);</li>
 *   <li>stable, contiguous global {@code sequence} (1..N in file order);</li>
 *   <li>numeric-aware, family-aware id numbering (U01..Un contiguous; per-family
 *       additional ids contiguous from 01, family name ↔ id prefix bijection);</li>
 *   <li>unique ids and unique names, dependency closure, dependency DAG (no cycles,
 *       no self-deps);</li>
 *   <li>additional entries may only depend on entries with a lower global sequence
 *       (no forward references — user deps included, so an additional row can never
 *       reference a later user contract such as U23 at sequence 273);</li>
 *   <li>core entries must never depend on stretch entries (cutting all stretch
 *       features must leave the core catalog closed under deps);</li>
 *   <li>expected origin/tier counts (user, additional core, additional stretch);</li>
 *   <li>non-blank dispositions (vanilla_overlap, summary, name, family).</li>
 * </ul>
 */
public final class CatalogValidator {
    private static final Pattern USER_ID = Pattern.compile("^U([0-9]{2})$");
    private static final Pattern FAMILY_ID = Pattern.compile("^([A-Z]{2,5})-([0-9]{2,3})$");

    private CatalogValidator() {
    }

    public static List<String> validate(Path catalogFile, Path schemaFile, Path expectedCountsFile) throws IOException {
        JsonObject schema = parseObject(schemaFile);
        JsonObject catalog = parseObject(catalogFile);
        JsonObject expectedCounts = parseObject(expectedCountsFile);
        return validate(catalog, schema, expectedCounts);
    }

    public static List<String> validate(JsonObject catalog, JsonObject schema, JsonObject expectedCounts) {
        List<String> errors = new ArrayList<>(SchemaValidator.validate(schema, catalog));
        if (!errors.isEmpty()) {
            // Structural problems make semantic checks unreliable; report them first.
            return errors;
        }
        errors.addAll(checkExpectedCountsShape(expectedCounts));
        if (!errors.isEmpty()) {
            return errors;
        }

        JsonArray entries = catalog.getAsJsonArray("entries");

        // Unique ids, preserving file order.
        Map<String, JsonObject> byId = new LinkedHashMap<>();
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            String id = entry.get("id").getAsString();
            if (byId.put(id, entry) != null) {
                errors.add("duplicate entry id '" + id + "'");
            }
        }

        checkSequence(entries, errors);
        checkUniqueNames(byId, errors);
        checkOriginAndContracts(byId, expectedCounts, errors);
        checkFamilyIds(byId, errors);
        checkDependencies(byId, errors);
        errors.addAll(findCycles(byId));
        checkDispositions(byId, errors);
        checkCounts(byId, expectedCounts, errors);

        return errors;
    }

    /** Human-readable origin/tier totals, e.g. for the CLI success line. */
    public static String describeCounts(JsonObject catalog) {
        int user = 0;
        int additionalCore = 0;
        int additionalStretch = 0;
        for (JsonElement element : catalog.getAsJsonArray("entries")) {
            JsonObject entry = element.getAsJsonObject();
            if ("user".equals(entry.get("origin").getAsString())) {
                user++;
            } else if ("core".equals(entry.get("tier").getAsString())) {
                additionalCore++;
            } else {
                additionalStretch++;
            }
        }
        int total = user + additionalCore + additionalStretch;
        return total + " entries (" + user + " user + " + additionalCore + " additional core + "
                + additionalStretch + " additional stretch)";
    }

    /** expected_counts.json must contain exactly: user, additional_core, additional_stretch. */
    private static List<String> checkExpectedCountsShape(JsonObject expectedCounts) {
        List<String> errors = new ArrayList<>();
        Set<String> required = Set.of("user", "additional_core", "additional_stretch");
        for (String key : required) {
            if (!expectedCounts.has(key) || !expectedCounts.get(key).isJsonPrimitive()
                    || !expectedCounts.get(key).getAsJsonPrimitive().isNumber()) {
                errors.add("expected_counts.json missing integer field '" + key + "'");
            }
        }
        for (String key : expectedCounts.keySet()) {
            if (!required.contains(key)) {
                errors.add("expected_counts.json has unknown field '" + key + "'");
            }
        }
        return errors;
    }

    /** Global sequence must be exactly 1..N in file order. */
    private static void checkSequence(JsonArray entries, List<String> errors) {
        for (int i = 0; i < entries.size(); i++) {
            JsonObject entry = entries.get(i).getAsJsonObject();
            int sequence = entry.get("sequence").getAsInt();
            if (sequence != i + 1) {
                errors.add("entry '" + entry.get("id").getAsString() + "' has sequence " + sequence
                        + " but file position requires " + (i + 1) + " (sequence must be contiguous 1..N in file order)");
            }
        }
    }

    /**
     * Origin/id-shape consistency plus the binding user contract mapping:
     * every user entry's contract_key must equal the canonical {@link UserContracts}
     * value for its id, user ids must be U01..Un contiguous in order, and when the
     * expected user count covers the whole contract table, every contract must be
     * present exactly once (strict one-to-one).
     */
    private static void checkOriginAndContracts(Map<String, JsonObject> byId, JsonObject expectedCounts, List<String> errors) {
        List<String> userIds = new ArrayList<>();
        Set<String> seenContracts = new HashSet<>();

        for (Map.Entry<String, JsonObject> mapEntry : byId.entrySet()) {
            String id = mapEntry.getKey();
            JsonObject entry = mapEntry.getValue();
            String origin = entry.get("origin").getAsString();
            boolean isUserId = USER_ID.matcher(id).matches();
            boolean isFamilyId = FAMILY_ID.matcher(id).matches();

            if (isUserId && !"user".equals(origin)) {
                errors.add("entry '" + id + "' has a U id but origin '" + origin + "'");
            }
            if (isFamilyId && !"additional".equals(origin)) {
                errors.add("entry '" + id + "' has a family id but origin '" + origin + "'");
            }

            if ("user".equals(origin)) {
                userIds.add(id);
                if (!"core".equals(entry.get("tier").getAsString())) {
                    errors.add("user entry '" + id + "' must have tier 'core' (all binding user contracts are core scope)");
                }
                if (!entry.has("contract_key")) {
                    errors.add("user entry '" + id + "' is missing required 'contract_key'");
                    continue;
                }
                String contractKey = entry.get("contract_key").getAsString();
                UserContracts.Contract contract = UserContracts.BY_ID.get(id);
                if (contract == null) {
                    errors.add("user entry '" + id + "' is not a known user contract id (table has "
                            + UserContracts.BY_ID.size() + " entries)");
                } else {
                    if (!contract.contractKey().equals(contractKey)) {
                        errors.add("user entry '" + id + "' has contract_key '" + contractKey
                                + "' but the binding contract table requires '" + contract.contractKey() + "'");
                    }
                    // The contract binds more than the key: canonical name and family are
                    // enforced too, so an entry cannot be repurposed while keeping its key.
                    String name = entry.get("name").getAsString();
                    if (!contract.name().equals(name)) {
                        errors.add("user entry '" + id + "' has name '" + name
                                + "' but the binding contract table requires '" + contract.name() + "'");
                    }
                    String family = entry.get("family").getAsString();
                    if (!contract.family().equals(family)) {
                        errors.add("user entry '" + id + "' has family '" + family
                                + "' but the binding contract table requires '" + contract.family() + "'");
                    }
                }
                if (!seenContracts.add(contractKey)) {
                    errors.add("contract_key '" + contractKey + "' is used by more than one entry");
                }
            } else if (entry.has("contract_key")) {
                errors.add("additional entry '" + id + "' must not declare 'contract_key' (reserved for user contracts)");
            }
        }

        // User ids must be numerically contiguous from U01 and appear in ascending order.
        for (int i = 0; i < userIds.size(); i++) {
            String expectedId = String.format("U%02d", i + 1);
            if (!expectedId.equals(userIds.get(i))) {
                errors.add("user ids must be contiguous and ordered U01..U" + String.format("%02d", userIds.size())
                        + "; found '" + userIds.get(i) + "' at user position " + (i + 1));
                break;
            }
        }

        // Strict one-to-one coverage when the expected user count equals the full table.
        int expectedUser = expectedCounts.has("user") ? expectedCounts.get("user").getAsInt() : -1;
        if (expectedUser == UserContracts.ALL.size()) {
            for (UserContracts.Contract contract : UserContracts.ALL) {
                if (!byId.containsKey(contract.id())) {
                    errors.add("missing binding user contract '" + contract.id() + "' (" + contract.contractKey() + ")");
                }
            }
        }
    }

    /**
     * Family-aware additional ids: family name ↔ id prefix must be a bijection, and the
     * numeric parts within a family must be unique and contiguous from 1 (numeric-aware,
     * so PWR-99 → PWR-100 is legal).
     */
    private static void checkFamilyIds(Map<String, JsonObject> byId, List<String> errors) {
        Map<String, String> prefixToFamily = new HashMap<>();
        Map<String, String> familyToPrefix = new HashMap<>();
        Map<String, List<Integer>> numbersByPrefix = new TreeMap<>();

        for (Map.Entry<String, JsonObject> mapEntry : byId.entrySet()) {
            Matcher matcher = FAMILY_ID.matcher(mapEntry.getKey());
            if (!matcher.matches()) {
                continue;
            }
            String prefix = matcher.group(1);
            int number = Integer.parseInt(matcher.group(2));
            String family = mapEntry.getValue().get("family").getAsString();

            String knownFamily = prefixToFamily.putIfAbsent(prefix, family);
            if (knownFamily != null && !knownFamily.equals(family)) {
                errors.add("id prefix '" + prefix + "' is used by families '" + knownFamily + "' and '" + family + "'");
            }
            String knownPrefix = familyToPrefix.putIfAbsent(family, prefix);
            if (knownPrefix != null && !knownPrefix.equals(prefix)) {
                errors.add("family '" + family + "' is used by id prefixes '" + knownPrefix + "' and '" + prefix + "'");
            }
            numbersByPrefix.computeIfAbsent(prefix, key -> new ArrayList<>()).add(number);
        }

        for (Map.Entry<String, List<Integer>> group : numbersByPrefix.entrySet()) {
            List<Integer> numbers = new ArrayList<>(group.getValue());
            List<Integer> sorted = new ArrayList<>(numbers);
            sorted.sort(Integer::compareTo);
            for (int i = 0; i < sorted.size(); i++) {
                if (sorted.get(i) != i + 1) {
                    errors.add("family prefix '" + group.getKey() + "' ids must be contiguous from 01; expected number "
                            + (i + 1) + " but found " + sorted.get(i));
                    break;
                }
            }
            if (!numbers.equals(sorted)) {
                errors.add("family prefix '" + group.getKey() + "' ids must appear in ascending numeric order");
            }
        }
    }

    /** Entry names must be unique across the whole catalog (no silent duplicates). */
    private static void checkUniqueNames(Map<String, JsonObject> byId, List<String> errors) {
        Map<String, String> nameToId = new HashMap<>();
        for (JsonObject entry : byId.values()) {
            String id = entry.get("id").getAsString();
            String name = entry.get("name").getAsString();
            String otherId = nameToId.putIfAbsent(name, id);
            if (otherId != null) {
                errors.add("duplicate entry name '" + name + "' used by '" + otherId + "' and '" + id + "'");
            }
        }
    }

    private static void checkDependencies(Map<String, JsonObject> byId, List<String> errors) {
        for (JsonObject entry : byId.values()) {
            String id = entry.get("id").getAsString();
            for (JsonElement dep : entry.getAsJsonArray("deps")) {
                String depId = dep.getAsString();
                if (depId.equals(id)) {
                    errors.add("entry '" + id + "' depends on itself");
                    continue;
                }
                JsonObject depEntry = byId.get(depId);
                if (depEntry == null) {
                    errors.add("entry '" + id + "' depends on unknown id '" + depId + "'");
                    continue;
                }
                // Additional entries may only reference entries that come earlier in
                // the global sequence (no forward deps). User deps are included: with
                // U23 at sequence 273, an additional row before it must not reference
                // it — only the later VFX rows (274..300) may.
                if ("additional".equals(entry.get("origin").getAsString())
                        && depEntry.get("sequence").getAsInt() >= entry.get("sequence").getAsInt()) {
                    errors.add("additional entry '" + id + "' (sequence " + entry.get("sequence").getAsInt()
                            + ") has forward dependency on '" + depId + "' (sequence "
                            + depEntry.get("sequence").getAsInt()
                            + "); additional deps must reference lower-sequence entries (user contracts included)");
                }
                // Core scope must stay closed under deps when all stretch entries are cut.
                if ("core".equals(entry.get("tier").getAsString())
                        && "stretch".equals(depEntry.get("tier").getAsString())) {
                    errors.add("core entry '" + id + "' depends on stretch entry '" + depId
                            + "'; core must remain independent from stretch");
                }
            }
        }
    }

    private static void checkDispositions(Map<String, JsonObject> byId, List<String> errors) {
        for (JsonObject entry : byId.values()) {
            String id = entry.get("id").getAsString();
            for (String field : new String[] {"vanilla_overlap", "summary", "name", "family"}) {
                if (entry.get(field).getAsString().isBlank()) {
                    errors.add("entry '" + id + "' has blank '" + field + "'");
                }
            }
        }
    }

    /** Expected origin/tier counts: user total, additional core, additional stretch. */
    private static void checkCounts(Map<String, JsonObject> byId, JsonObject expectedCounts, List<String> errors) {
        int user = 0;
        int additionalCore = 0;
        int additionalStretch = 0;
        for (JsonObject entry : byId.values()) {
            if ("user".equals(entry.get("origin").getAsString())) {
                user++;
            } else if ("core".equals(entry.get("tier").getAsString())) {
                additionalCore++;
            } else {
                additionalStretch++;
            }
        }
        int expectedUser = expectedCounts.get("user").getAsInt();
        int expectedAdditionalCore = expectedCounts.get("additional_core").getAsInt();
        int expectedAdditionalStretch = expectedCounts.get("additional_stretch").getAsInt();
        if (user != expectedUser) {
            errors.add("expected " + expectedUser + " user entries but found " + user);
        }
        if (additionalCore != expectedAdditionalCore) {
            errors.add("expected " + expectedAdditionalCore + " additional core entries but found " + additionalCore);
        }
        if (additionalStretch != expectedAdditionalStretch) {
            errors.add("expected " + expectedAdditionalStretch + " additional stretch entries but found " + additionalStretch);
        }
    }

    private static List<String> findCycles(Map<String, JsonObject> byId) {
        List<String> errors = new ArrayList<>();
        Map<String, Integer> state = new HashMap<>(); // 0/absent=unvisited, 1=in stack, 2=done
        for (String start : byId.keySet()) {
            if (state.getOrDefault(start, 0) != 0) {
                continue;
            }
            Deque<String> stack = new ArrayDeque<>();
            Deque<List<String>> pendingDeps = new ArrayDeque<>();
            stack.push(start);
            pendingDeps.push(depsOf(byId, start));
            state.put(start, 1);
            while (!stack.isEmpty()) {
                List<String> deps = pendingDeps.peek();
                if (deps.isEmpty()) {
                    state.put(stack.pop(), 2);
                    pendingDeps.pop();
                    continue;
                }
                String next = deps.remove(deps.size() - 1);
                if (!byId.containsKey(next)) {
                    continue; // reported by the closure check
                }
                int nextState = state.getOrDefault(next, 0);
                if (nextState == 1) {
                    errors.add("dependency cycle detected involving '" + next + "'");
                } else if (nextState == 0) {
                    stack.push(next);
                    pendingDeps.push(depsOf(byId, next));
                    state.put(next, 1);
                }
            }
        }
        return errors;
    }

    private static List<String> depsOf(Map<String, JsonObject> byId, String id) {
        List<String> deps = new ArrayList<>();
        for (JsonElement dep : byId.get(id).getAsJsonArray("deps")) {
            deps.add(dep.getAsString());
        }
        return deps;
    }

    public static JsonObject parseObject(Path file) throws IOException {
        String content = Files.readString(file, StandardCharsets.UTF_8);
        return JsonParser.parseString(content).getAsJsonObject();
    }

    // Convenience for tests.
    static Set<String> ids(JsonObject catalog) {
        Set<String> ids = new HashSet<>();
        for (JsonElement element : catalog.getAsJsonArray("entries")) {
            ids.add(element.getAsJsonObject().get("id").getAsString());
        }
        return ids;
    }
}
