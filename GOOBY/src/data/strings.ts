/**
 * Compatibility re-export. The canonical typed string catalogs live in
 * `src/i18n` (English and German with enforced parity plus a runtime language
 * switch). Existing modules keep importing the frozen English bindings from
 * here; language-aware code should use `activeCatalog()` from `src/i18n`.
 */
export {
  EN_STRINGS as STRINGS,
  EN_SHOP_COPY as SHOP_COPY,
  EN_MINIGAME_COPY as MINIGAME_COPY,
  EN_WARDROBE_COPY as WARDROBE_COPY,
  EN_FURNITURE_COPY as FURNITURE_COPY,
} from "../i18n/en";
