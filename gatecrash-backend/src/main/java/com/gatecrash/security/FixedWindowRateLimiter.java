package com.gatecrash.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A small fixed-window counter used to throttle credential-guessing endpoints (login, PIN redemption).
 *
 * <p><b>Scope:</b> in-process. With more than one backend instance behind a load balancer the effective
 * limit is (instances x limit), which still bounds an attack by orders of magnitude but is not exact.
 * Moving this to Redis is the right step when the deployment goes multi-instance; the interface is
 * shaped so that swap is a drop-in.
 *
 * <p>Entries are purged on a timer so a flood of distinct keys cannot grow the map without bound.
 */
@Component
public class FixedWindowRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(FixedWindowRateLimiter.class);

    /** Hard cap on tracked keys; beyond it new keys are not tracked rather than risking heap exhaustion. */
    private static final int MAX_TRACKED_KEYS = 100_000;

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    /**
     * @return true if the caller is within budget (the attempt is recorded), false if it must be refused
     */
    public boolean tryAcquire(String key, int limit, Duration window) {
        Instant now = Instant.now();
        Window current = windows.compute(key, (k, existing) -> {
            if (existing == null || existing.expiresAt.isBefore(now)) {
                if (existing == null && windows.size() >= MAX_TRACKED_KEYS) {
                    log.warn("Rate limiter key capacity reached; not tracking new key");
                    return null;
                }
                return new Window(now.plus(window));
            }
            return existing;
        });
        if (current == null) {
            return true;
        }
        return current.count.incrementAndGet() <= limit;
    }

    /** Current consumption for a key without recording an attempt. */
    public int count(String key) {
        Window window = windows.get(key);
        if (window == null || window.expiresAt.isBefore(Instant.now())) {
            return 0;
        }
        return window.count.get();
    }

    /** Called on success so a legitimate user is not punished for earlier typos. */
    public void reset(String key) {
        windows.remove(key);
    }

    @Scheduled(fixedDelay = 60_000)
    void purgeExpired() {
        Instant now = Instant.now();
        windows.entrySet().removeIf(entry -> entry.getValue().expiresAt.isBefore(now));
    }

    private static final class Window {
        private final Instant expiresAt;
        private final AtomicInteger count = new AtomicInteger();

        private Window(Instant expiresAt) {
            this.expiresAt = expiresAt;
        }
    }
}
