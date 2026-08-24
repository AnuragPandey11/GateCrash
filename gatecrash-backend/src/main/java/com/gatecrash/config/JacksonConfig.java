package com.gatecrash.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class JacksonConfig {

    @Bean
    Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> builder
                // ISO-8601 strings, not epoch numbers: the mobile clients parse timestamps directly.
                .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                // Reject unknown properties rather than ignoring them. A client sending a field the
                // server does not understand is a bug or a probe, and silently dropping it is how
                // mass-assignment surprises start.
                .featuresToEnable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                // A JSON null for a primitive is a client error, not a zero.
                .featuresToEnable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
    }
}
