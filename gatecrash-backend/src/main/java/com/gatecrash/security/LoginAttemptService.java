package com.gatecrash.security;

import com.gatecrash.common.exception.TooManyRequestsException;
import com.gatecrash.config.AppProperties;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Locale;

/**
 * Brute-force protection for {@code POST /auth/login}.
 *
 * <p>Two independent budgets are enforced, because either alone is easy to sidestep:
 * <ul>
 *   <li>per login id -- stops an attacker grinding one account from many addresses;</li>
 *   <li>per client address -- stops password spraying across many accounts from one host.</li>
 * </ul>
 *
 * <p>The per-address budget is deliberately looser: a whole apartment block behind one NAT address
 * shares it, and locking out an entire building because one resident fat-fingered their password
 * would be a self-inflicted denial of service.
 */
@Service
@RequiredArgsConstructor
public class LoginAttemptService {

    private static final Logger log = LoggerFactory.getLogger(LoginAttemptService.class);

    /** Multiplier applied to the per-account budget to derive the shared per-address budget. */
    private static final int ADDRESS_BUDGET_MULTIPLIER = 6;

    private final FixedWindowRateLimiter limiter;
    private final AppProperties properties;

    public void assertNotLockedOut(String loginId, String clientAddress) {
        int max = properties.security().login().maxAttempts();
        if (limiter.count(accountKey(loginId)) >= max) {
            log.warn("Login blocked: account budget exhausted for login id ending '{}'", tail(loginId));
            throw lockedOut();
        }
        if (limiter.count(addressKey(clientAddress)) >= max * ADDRESS_BUDGET_MULTIPLIER) {
            log.warn("Login blocked: address budget exhausted for {}", clientAddress);
            throw lockedOut();
        }
    }

    public void recordFailure(String loginId, String clientAddress) {
        Duration window = Duration.ofMinutes(properties.security().login().lockoutMinutes());
        limiter.tryAcquire(accountKey(loginId), Integer.MAX_VALUE, window);
        limiter.tryAcquire(addressKey(clientAddress), Integer.MAX_VALUE, window);
    }

    public void recordSuccess(String loginId, String clientAddress) {
        limiter.reset(accountKey(loginId));
        limiter.reset(addressKey(clientAddress));
    }

    /** True once the account budget is spent -- used to decide whether to audit a lockout event. */
    public boolean isLockedOut(String loginId) {
        return limiter.count(accountKey(loginId)) >= properties.security().login().maxAttempts();
    }

    private TooManyRequestsException lockedOut() {
        return new TooManyRequestsException(
                "Too many failed sign-in attempts. Try again in "
                        + properties.security().login().lockoutMinutes() + " minutes.");
    }

    private String accountKey(String loginId) {
        return "login:account:" + (loginId == null ? "" : loginId.toLowerCase(Locale.ROOT));
    }

    private String addressKey(String clientAddress) {
        return "login:address:" + (clientAddress == null ? "unknown" : clientAddress);
    }

    /** Log-safe fragment of a login id -- enough to correlate, not enough to harvest. */
    private String tail(String loginId) {
        if (loginId == null || loginId.length() <= 2) {
            return "**";
        }
        return "**" + loginId.substring(loginId.length() - 2);
    }
}
