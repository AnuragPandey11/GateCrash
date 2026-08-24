package com.gatecrash.common;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Best-effort client address, used only for rate-limiting and audit context.
 *
 * <p>{@code X-Forwarded-For} is client-supplied and trivially spoofed, so it is honoured only when
 * the deployment sits behind a proxy that appends to it -- in which case the <em>last</em> entry is
 * the one the trusted proxy observed. Nothing security-critical is ever decided from this value: it
 * makes brute forcing more expensive, it does not authorise anything.
 */
public final class ClientAddressResolver {

    private static final String FORWARDED_FOR = "X-Forwarded-For";
    private static final int MAX_LENGTH = 45;   // an IPv6 literal at its longest

    private ClientAddressResolver() {
    }

    public static String resolve(HttpServletRequest request) {
        String forwarded = request.getHeader(FORWARDED_FOR);
        if (forwarded != null && !forwarded.isBlank()) {
            String[] hops = forwarded.split(",");
            String candidate = hops[hops.length - 1].trim();
            if (isPlausible(candidate)) {
                return candidate;
            }
        }
        String remote = request.getRemoteAddr();
        return remote == null ? "unknown" : remote;
    }

    private static boolean isPlausible(String value) {
        if (value.isEmpty() || value.length() > MAX_LENGTH) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            boolean allowed = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
                    || c == '.' || c == ':';
            if (!allowed) {
                return false;
            }
        }
        return true;
    }
}
