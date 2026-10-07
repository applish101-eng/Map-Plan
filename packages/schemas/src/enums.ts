export const verificationStatuses = ['NEW', 'REVIEW', 'VALID', 'NOT_VALID', 'EXPIRED'] as const
export type VerificationStatus = (typeof verificationStatuses)[number]

export const confidenceLevels = ['LOW', 'MEDIUM', 'HIGH'] as const
export type ConfidenceLevel = (typeof confidenceLevels)[number]

export const accessStatuses = ['OPEN', 'RESTRICTED', '4WD_ONLY', 'BLOCKED', 'DAMAGED', 'UNKNOWN'] as const
export type AccessStatus = (typeof accessStatuses)[number]

export const deliveryStatuses = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type DeliveryStatus = (typeof deliveryStatuses)[number]

export const userRoles = ['ADMIN', 'EDITOR', 'VIEWER'] as const
export type UserRole = (typeof userRoles)[number]

export const categoryCodes = [
  'FOOD',
  'WATER',
  'HYGIENE_WASH',
  'SHELTER_NFI',
  'HEALTH',
  'PROTECTION',
  'EDUCATION',
  'CASH_VOUCHER',
  'OTHER',
] as const
export type CategoryCode = (typeof categoryCodes)[number]

/**
 * How constrained is a road? Mirrors ops.access_rank() in migration 0003.
 *
 * UNKNOWN is 6, above BLOCKED at 5, and that ordering is deliberate: a road
 * nobody has verified is operationally more dangerous than a road known to be
 * blocked, because a driver will attempt it. Never reorder this to make
 * "worst = BLOCKED" read more naturally - the map would then render unverified
 * roads as the safest thing on the map.
 */
export const accessRank: Record<AccessStatus, number> = {
  OPEN: 1,
  RESTRICTED: 2,
  '4WD_ONLY': 3,
  DAMAGED: 4,
  BLOCKED: 5,
  UNKNOWN: 6,
}

export const accessStatusLabels: Record<AccessStatus, string> = {
  OPEN: 'Open',
  RESTRICTED: 'Restricted',
  '4WD_ONLY': '4WD only',
  BLOCKED: 'Blocked',
  DAMAGED: 'Damaged',
  UNKNOWN: 'Unknown',
}

/**
 * Line style per access status (spec 12.3).
 *
 * Road status is carried by dash pattern as well as colour, so six states stay
 * distinguishable in greyscale print and for colour-vision deficiency. A change
 * to colour alone is a regression.
 */
export const accessLineStyle: Record<AccessStatus, { dash: number[]; width: number }> = {
  OPEN: { dash: [], width: 2.5 },
  RESTRICTED: { dash: [4, 2], width: 2.5 },
  '4WD_ONLY': { dash: [8, 2, 2, 2], width: 2.5 },
  BLOCKED: { dash: [], width: 3.5 },
  DAMAGED: { dash: [1.5, 1.5], width: 2.5 },
  UNKNOWN: { dash: [0.5, 3], width: 2 },
}

export const accessStatusColors: Record<AccessStatus, string> = {
  OPEN: 'var(--status-open)',
  RESTRICTED: 'var(--status-restricted)',
  '4WD_ONLY': 'var(--status-4wd)',
  BLOCKED: 'var(--status-blocked)',
  DAMAGED: 'var(--status-damaged)',
  UNKNOWN: 'var(--status-unknown)',
}