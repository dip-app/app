// Admin backend (docs/contracts/admin.md): permissions, audit log, album moderation, attendee and member
// management, bulk import and roster pre-provisioning.
export {
  removeEventPhotoV1, removeEventPhotoCommentV1, addEventAttendeeV1, removeEventAttendeeV1, recordAttendanceV1, listMembersV1, getMemberV1,
  updateMemberV1, resetMemberProfileV1, setMemberStatusV1, adjustMemberPointsV1, upsertTeamV1,
  upsertRosterEntryV1, revokeRosterEntryV1, resendRosterInviteV1, listRosterV1, backfillRosterV1, importEmployeesV1, applyEmployeeImportV1, getEmployeeImportV1,
} from "./transport/adminCallables";
