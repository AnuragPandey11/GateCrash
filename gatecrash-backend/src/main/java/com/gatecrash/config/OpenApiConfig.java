package com.gatecrash.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * API documentation. Disabled entirely under the prod profile via {@code springdoc.api-docs.enabled}
 * -- a complete map of the endpoint surface is free reconnaissance for anyone who finds the host.
 */
@Configuration
public class OpenApiConfig {

    private static final String BEARER_SCHEME = "bearerAuth";

    @Bean
    OpenAPI gateCrashOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("GateCrash Township ERP API")
                        .version("v1")
                        .description("""
                                Visitor management and targeted notifications.

                                All endpoints except `/auth/login` and `/auth/refresh` require a bearer
                                access token. Accounts are admin-provisioned; there is no self-signup.
                                Until a user clears `mustResetPassword`, every endpoint outside
                                `/auth/**` returns 403 `PASSWORD_RESET_REQUIRED`.""")
                        .license(new License().name("Proprietary")))
                .components(new Components().addSecuritySchemes(BEARER_SCHEME,
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME));
    }
}
