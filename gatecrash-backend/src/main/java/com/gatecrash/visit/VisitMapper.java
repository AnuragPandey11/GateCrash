package com.gatecrash.visit;

import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import org.springframework.stereotype.Component;

@Component
public class VisitMapper {

    public VisitResponse toResponse(VisitorLog visit) {
        return new VisitResponse(
                visit.getId(),
                visit.getGate().getId(),
                visit.getGate().getName(),
                visit.getVisitorName(),
                visit.getVisitorPhone(),
                visit.getVisitorType(),
                visit.getVehicleNo(),
                visit.getPhotoUrl(),
                visit.getStatus(),
                visit.getApproverKind(),
                visit.getApproverId(),
                visit.getApprover() == null ? null : visit.getApprover().getFullName(),
                visit.getTargetFlatId(),
                visit.getTargetFlat() == null ? null : visit.getTargetFlat().getNumber(),
                visit.getPreApproval() == null ? null : visit.getPreApproval().getId(),
                visit.getLoggedBy() == null ? null : visit.getLoggedBy().getFullName(),
                visit.getCreatedAt(),
                visit.getDecidedAt(),
                visit.getCheckedInAt(),
                visit.getCheckedOutAt());
    }
}
