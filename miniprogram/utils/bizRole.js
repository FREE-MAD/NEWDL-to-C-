const BIZ_ROLE_VISITOR = 'visitor'
const BIZ_ROLE_FREE_COACH = 'free_coach'
const BIZ_ROLE_ORG_ADMIN = 'org_admin'
const BIZ_ROLE_ORG_COACH = 'org_coach'

const BIZ_ROLE_LABEL_MAP = {
  [BIZ_ROLE_VISITOR]: '访客模式',
  [BIZ_ROLE_FREE_COACH]: '自由教练',
  [BIZ_ROLE_ORG_ADMIN]: '机构管理层',
  [BIZ_ROLE_ORG_COACH]: '机构执行教练'
}

// 新增默认机构信息：当前先给前端分流骨架使用，后续接真实机构接口时可以直接替换
function createEmptyOrganizationProfile() {
  return {
    orgId: '',
    orgName: '',
    memberRole: '',
    joinedAt: '',
    source: ''
  }
}

function normalizePlatformRole(role = '') {
  return role === 'C' ? 'C' : 'V'
}

function normalizeOrganizationProfile(profile = {}) {
  const nextProfile = {
    ...createEmptyOrganizationProfile(),
    ...profile
  }

  nextProfile.orgId = String(nextProfile.orgId || nextProfile.organizationId || '').trim()
  nextProfile.orgName = String(nextProfile.orgName || nextProfile.organizationName || '').trim()
  nextProfile.memberRole = String(nextProfile.memberRole || nextProfile.orgRole || '').trim()
  nextProfile.joinedAt = String(nextProfile.joinedAt || '').trim()
  nextProfile.source = String(nextProfile.source || '').trim()

  return nextProfile
}

function isOrgAdminRole(memberRole = '') {
  return ['admin', 'manager', 'owner'].includes(String(memberRole || '').trim())
}

// 新增业务角色统一推导：显式业务角色优先，其次根据机构归属和平台身份自动回推
function resolveBusinessRole(identity = {}) {
  const explicitBizRole = String(identity.bizRole || '').trim()
  // 新增访客模式回退：显式传 visitor 时，仍允许根据后续真实教练痕迹自动升级成教练业务角色
  if (explicitBizRole && explicitBizRole !== BIZ_ROLE_VISITOR) {
    return explicitBizRole
  }

  const platformRole = normalizePlatformRole(identity.userRole || identity.role)
  const organizationProfile = normalizeOrganizationProfile(
    identity.organizationProfile || identity.orgProfile || {
      orgId: identity.orgId,
      orgName: identity.orgName,
      memberRole: identity.orgMemberRole || identity.memberRole
    }
  )

  if (organizationProfile.orgId) {
    return isOrgAdminRole(organizationProfile.memberRole)
      ? BIZ_ROLE_ORG_ADMIN
      : BIZ_ROLE_ORG_COACH
  }

  if (platformRole === 'C') {
    return BIZ_ROLE_FREE_COACH
  }

  return BIZ_ROLE_VISITOR
}

function getBizRoleLabel(bizRole = '') {
  return BIZ_ROLE_LABEL_MAP[bizRole] || BIZ_ROLE_LABEL_MAP[BIZ_ROLE_VISITOR]
}

function isCourseCreatorRole(bizRole = '') {
  return [BIZ_ROLE_FREE_COACH, BIZ_ROLE_ORG_ADMIN].includes(String(bizRole || '').trim())
}

function canManageOrgCourse(bizRole = '') {
  return [BIZ_ROLE_ORG_ADMIN, BIZ_ROLE_ORG_COACH].includes(String(bizRole || '').trim())
}

module.exports = {
  BIZ_ROLE_VISITOR,
  BIZ_ROLE_FREE_COACH,
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH,
  createEmptyOrganizationProfile,
  normalizePlatformRole,
  normalizeOrganizationProfile,
  resolveBusinessRole,
  getBizRoleLabel,
  isOrgAdminRole,
  isCourseCreatorRole,
  canManageOrgCourse
}
