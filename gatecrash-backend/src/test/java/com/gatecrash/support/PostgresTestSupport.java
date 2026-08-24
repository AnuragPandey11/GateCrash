package com.gatecrash.support;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.IOException;
import java.io.UncheckedIOException;

/**
 * Supplies a real PostgreSQL for the integration suite.
 *
 * <p>These tests run the actual Flyway migration and let Hibernate validate every mapping against it,
 * so an in-memory H2 would be worse than useless -- it has no native enum types, no JSONB, no
 * partial indexes, and would happily pass while production failed at boot.
 *
 * <p>Two backends, one interface:
 * <ul>
 *   <li><b>Testcontainers</b> when a Docker daemon is reachable. This is the CI path and the one
 *       BACKEND.md section 12 specifies.</li>
 *   <li><b>Embedded PostgreSQL</b> otherwise -- a real {@code postgres} binary in a temp directory.
 *       Without this, the whole suite is unrunnable on any machine without Docker, and a test suite
 *       people cannot run is a test suite that rots.</li>
 * </ul>
 *
 * <p>One instance is started per JVM and shared by every test class, which keeps the suite fast; each
 * test class is responsible for its own data isolation.
 */
public final class PostgresTestSupport {

    private static final String DATABASE = "gatecrash";
    private static final String USERNAME = "gatecrash";
    private static final String PASSWORD = "gatecrash";

    private static volatile Handle handle;

    private PostgresTestSupport() {
    }

    public static synchronized Handle instance() {
        if (handle == null) {
            handle = dockerAvailable() ? startContainer() : startEmbedded();
        }
        return handle;
    }

    private static boolean dockerAvailable() {
        try {
            return DockerClientFactory.instance().isDockerAvailable();
        } catch (RuntimeException ex) {
            return false;
        }
    }

    @SuppressWarnings("resource")   // deliberately outlives the test class; torn down with the JVM
    private static Handle startContainer() {
        PostgreSQLContainer<?> container = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName(DATABASE)
                .withUsername(USERNAME)
                .withPassword(PASSWORD);
        container.start();
        Runtime.getRuntime().addShutdownHook(new Thread(container::stop));
        return new Handle(container.getJdbcUrl(), container.getUsername(), container.getPassword(),
                "testcontainers");
    }

    private static Handle startEmbedded() {
        try {
            EmbeddedPostgres postgres = EmbeddedPostgres.builder().start();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    postgres.close();
                } catch (IOException ignored) {
                    // JVM is going down anyway.
                }
            }));
            return new Handle(postgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres",
                    "embedded");
        } catch (IOException ex) {
            throw new UncheckedIOException("Unable to start an embedded PostgreSQL for tests", ex);
        }
    }

    public record Handle(String jdbcUrl, String username, String password, String flavour) {
    }
}
