package com.gatecrash;

import com.gatecrash.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
public class GateCrashApplication {

    public static void main(String[] args) {
        SpringApplication.run(GateCrashApplication.class, args);
    }
}
