package dev.cuprum.catalogtool;

/**
 * Clean, message-first failure for catalog/concept validation and parsing.
 *
 * <p>Thrown instead of raw runtime failures (e.g. {@link NumberFormatException},
 * {@link IndexOutOfBoundsException}) so that malformed concept docs or catalog data
 * always fail with a precise, human-actionable message naming the file, row and cell
 * that is wrong. {@link ConceptParity#validate} converts these into error strings so
 * the {@code verifyConceptParity} CLI and the mutation tests see them as ordinary
 * validation errors.
 */
public class CatalogValidationException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public CatalogValidationException(String message) {
        super(message);
    }
}
