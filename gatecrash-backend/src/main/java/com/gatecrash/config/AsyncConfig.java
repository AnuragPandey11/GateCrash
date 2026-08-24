package com.gatecrash.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Executor for out-of-band push delivery.
 *
 * <p>Explicitly bounded rather than using Spring's default {@code SimpleAsyncTaskExecutor}, which
 * creates an unbounded thread per task -- a slow FCM endpoint would then translate directly into
 * thread exhaustion. The queue is bounded too, and the rejection policy is CallerRuns: under
 * sustained overload the calling thread absorbs the work and back-pressure reaches the gate rather
 * than pushes being silently dropped.
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "pushExecutor")
    public Executor pushExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(500);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("push-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(20);
        executor.initialize();
        return executor;
    }
}
