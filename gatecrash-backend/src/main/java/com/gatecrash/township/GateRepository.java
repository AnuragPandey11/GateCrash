package com.gatecrash.township;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface GateRepository extends JpaRepository<Gate, UUID> {

    boolean existsByNameIgnoreCase(String name);

    List<Gate> findAllByOrderByNameAsc();
}
