package com.gatecrash.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

import javax.sql.DataSource;
import java.time.Duration;

/**
 * Scheduled jobs, made safe for multi-instance deployments.
 *
 * <p>Every instance runs the same {@code @Scheduled} triggers, so without a distributed lock the
 * expiry sweeps would fire once per replica. The jobs are written to be idempotent regardless, but
 * ShedLock keeps them to one leader per tick, which also stops N instances from each broadcasting the
 * same WebSocket expiry event to the same gate.
 */
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "PT5M")
// Excluded from the test profile so the every-minute sweeps cannot fire mid-assertion. The job bean
// itself still exists, and ExpirySweepJobTest invokes it directly.
@Profile("!test")
public class SchedulingConfig {

    @Bean
    LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(
                JdbcTemplateLockProvider.Configuration.builder()
                        .withJdbcTemplate(new JdbcTemplate(dataSource))
                        .withTableName("shedlock")
                        // Timestamps are compared in the database, so a clock skewed between app
                        // instances cannot let two of them hold the same lock.
                        .usingDbTime()
                        .build());
    }

    /** Shared default: how long a lock is held if a job dies without releasing it. */
    public static final Duration DEFAULT_LOCK_AT_MOST_FOR = Duration.ofMinutes(5);
}
