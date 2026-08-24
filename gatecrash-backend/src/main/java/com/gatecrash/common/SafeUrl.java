package com.gatecrash.common;

import com.gatecrash.common.exception.BusinessValidationException;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Validation for client-supplied URLs (gate snapshots, community post images).
 *
 * <p>The server never dereferences these -- they are handed to mobile and web clients to render. The
 * threat is therefore not SSRF but what a client does with a hostile scheme: a {@code javascript:}
 * or {@code data:} URL rendered into an {@code <img>} or opened by a WebView is script execution in
 * the victim's session. Restricting to {@code https} removes the whole class, and also stops a plain
 * {@code http} image from downgrading an otherwise secure page.
 */
public final class SafeUrl {

    private static final int MAX_LENGTH = 2048;

    private SafeUrl() {
    }

    /** @return the normalised URL, or null if the input was absent */
    public static String validateHttps(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() > MAX_LENGTH) {
            throw new BusinessValidationException("INVALID_URL", fieldName + " is too long.");
        }
        try {
            URI uri = new URI(trimmed);
            String scheme = uri.getScheme();
            if (scheme == null || !scheme.toLowerCase(Locale.ROOT).equals("https")) {
                throw new BusinessValidationException("INVALID_URL",
                        fieldName + " must be an https URL.");
            }
            if (uri.getHost() == null || uri.getHost().isBlank()) {
                throw new BusinessValidationException("INVALID_URL", fieldName + " must have a host.");
            }
            // user:password@host is never legitimate here and is a classic phishing/obfuscation trick.
            if (uri.getUserInfo() != null) {
                throw new BusinessValidationException("INVALID_URL",
                        fieldName + " must not contain credentials.");
            }
            return trimmed;
        } catch (URISyntaxException ex) {
            throw new BusinessValidationException("INVALID_URL", fieldName + " is not a valid URL.");
        }
    }
}
