import {
  defineCustomerSuccessPreferences,
  validateCustomerSuccessUserProfileData,
} from "@ai-career/customer-success";

const customerSuccessPreferences = defineCustomerSuccessPreferences({
  salary: {
    currency: "USD",
    passMinimum: 60_000,
    reviewMinimum: 55_000,
    substantiallyLowerCostCountries: [],
  },
  location: {
    allowedCountries: [],
    disallowedCountries: [],
    allowUnitedStatesOnlyRoles: true,
  },
  travel: {
    allowInfrequentCompanyEvents: true,
    allowExceptionalCustomerVisits: true,
    recurringCustomerOnsiteResult: "FAIL",
    fieldTravelResult: "FAIL",
  },
  workArrangement: {
    allowed: ["REMOTE"],
    unknownResult: "UNKNOWN",
  },
  roleFamilies: {
    continuingClassifications: [
      "CORE_CS",
      "CS_ADJACENT",
      "SUPPORT_HEAVY",
      "SALES_HEAVY",
      "IMPLEMENTATION_HEAVY",
      "TECHNICAL_CS",
    ],
  },
  companyPreferences: {
    preferredBusinessModels: ["SAAS", "SOFTWARE", "TECHNOLOGY"],
    alsoAlignedBusinessModels: ["EDTECH", "MARKETPLACE", "SUBSCRIPTION"],
  },
  productPreferences: {
    preferredProductTypes: [
      "WORKFLOW",
      "PRODUCTIVITY",
      "COLLABORATION",
      "LEARNING",
      "AUTOMATION",
      "NO_CODE",
      "LOW_CODE",
    ],
    moderatelyTechnicalAlignedWork: [
      "ONBOARDING",
      "EDUCATION",
      "ENABLEMENT",
      "ADOPTION",
      "CUSTOMER_GUIDANCE",
    ],
    developerFocusedRequiresDeepEngineeringConcern: true,
  },
  customerPreferences: {
    customerTypes: [
      "B2C",
      "B2B2C",
      "LIGHT_B2B",
      "ENTERPRISE_HEAVY_B2B",
      "MIXED",
    ],
    customerSegments: [
      "SMB",
      "MID_MARKET",
      "COMMERCIAL",
      "ENTERPRISE",
      "MIXED",
    ],
    enterpriseRequiresContextualEvidenceForConcern: true,
  },
  fitPreferences: {
    preferredAreas: [
      "ONBOARDING",
      "EDUCATION",
      "ENABLEMENT",
      "RELATIONSHIP_MANAGEMENT",
      "ENGAGEMENT",
      "RETENTION",
      "ADOPTION",
      "CUSTOMER_INSIGHTS",
      "CROSS_FUNCTIONAL_COLLABORATION",
      "DOCUMENTATION",
      "PROBLEM_SOLVING",
      "STRATEGY",
    ],
    comfortableAreas: [
      "MODERATE_SALES",
      "RENEWALS",
      "EXPANSION",
      "METRICS",
      "ADOPTION_TRACKING",
      "PRODUCT_FEEDBACK",
      "ANALYSIS",
    ],
    lowerAlignmentPatterns: [
      "REACTIVE_SUPPORT",
      "CALL_CENTER_WORK",
      "CONSTANT_INTERRUPTION",
      "MEETING_HEAVY_WORK",
      "CALL_VOLUME_KPIS",
      "LITTLE_STRATEGIC_RESPONSIBILITY",
    ],
  },
  workStylePreferences: {
    preferred: [
      "ASYNC_WORK",
      "DEEP_WORK",
      "DOCUMENTATION",
      "PROCESS_IMPROVEMENT",
      "EDUCATION",
      "CROSS_FUNCTIONAL_COLLABORATION",
      "FEEDBACK_LOOPS",
      "STRATEGIC_OWNERSHIP",
    ],
  },
  workloadPreferences: {
    complementaryCustomerSuccessResponsibilities: [
      "onboarding",
      "adoption",
      "education",
      "enablement",
      "relationship management",
      "retention",
    ],
    distinctFunctionOwnershipConcerns: [
      "implementation",
      "project management",
      "support",
      "product management",
      "community management",
      "revenue ownership",
      "large-scale documentation production",
      "recurring travel",
    ],
    genericPhrasesRequireCorroboration: true,
  },
  careerStrategy: {
    goals: [
      "Build a bridge toward software engineering and software development.",
      "Gain experience within software and technology organizations.",
      "Preserve international-employment options.",
      "Support a future European relocation.",
    ],
  },
});

export const alexandraNugentCustomerSuccessProfile =
  validateCustomerSuccessUserProfileData({
    label: "Alexandra Nugent - Customer Success canonical profile",
    careerGoals: [
      {
        id: "career-software-engineering",
        statement:
          "Use Customer Success as a strategic bridge toward software engineering and software development.",
      },
      {
        id: "career-technology-organizations",
        statement:
          "Build experience within software and technology organizations.",
      },
      {
        id: "career-international-employment",
        statement:
          "Preserve access to international employment and distributed teams.",
      },
      {
        id: "career-european-relocation",
        statement: "Support a future European relocation.",
      },
    ],
    experience: [
      {
        id: "experience-aggregate",
        relationship: "TRANSFERABLE",
        statement:
          "Customer-facing, consultative engagement and customer-education experience spans more than five years and more than 200 clients and users across the United States, Asia, and Europe; this is transferable Customer Success experience, not a claim of five years of literal SaaS account management.",
      },
      {
        id: "experience-nalcap-training-specialist",
        relationship: "TRANSFERABLE",
        statement:
          "Training Specialist, NALCAP, Madrid, Spain (October 2024-June 2026): directed 50+ structured English-learning sessions during a nine-month program cycle using multimedia, interactive platforms, and AI-assisted content adaptation, reducing manual preparation by 30%; provided individualized real-time guidance and outcome-driven coaching to 40+ participants, resolved blockers, and supported 90% attainment of required Cambridge English speaking-performance benchmarks; identified activity drop-off patterns and adjusted outreach, explanations, examples, timing, and next-step prompts, increasing active participation by 25% and follow-through consistency to 80%+.",
      },
      {
        id: "experience-barnes-noble-customer-engagement",
        relationship: "RELATED",
        statement:
          "Customer Engagement Associate, Barnes & Noble Inc., Illinois, United States (October 2022-October 2024): conducted 50+ monthly customer consultations, identified preferences and purchase-intent signals, and provided individualized book and product recommendations, contributing to a 25% increase in repeat visits; guided enrollment and value communication for 30+ prospective users weekly, reducing friction and supporting early benefit adoption with an 85% average conversion rate; translated purchasing patterns and customer feedback into product placement, recommendations, and promotional messaging, increasing interaction with priority offerings by 15%. This was retail customer engagement and enrollment work, not SaaS account management.",
      },
      {
        id: "experience-independent-esl-tutor",
        relationship: "TRANSFERABLE",
        statement:
          "Independent ESL Tutor, self-employed, remote (May 2025-present): manages 15-20 recurring international learners and coordinates 40+ monthly conversation-based sessions across time zones, independently handling scheduling, communication, lesson planning, and tailored materials with zero service interruptions and 95%+ scheduling adherence; uses personalized education and enablement resources to maintain 80%+ engagement and a corrected 55% long-term retention rate in a variable, high-churn platform environment; conducts weekly learner touchpoints and quarterly goal-alignment updates, sets expectations, resolves issues, and has a corrected satisfaction rating of 4.8/5. These are tutoring-client relationships, not literal SaaS accounts.",
      },
      {
        id: "experience-social-science-instructor",
        relationship: "TRANSFERABLE",
        statement:
          "Social Science Instructor, Shenzhen International Foundation College, Shenzhen, China (September 2020-June 2022): taught Social Studies and Geography to Grades 6-9 and localized American Common Core-aligned content for four multilingual learner segments across two subjects, translating 40+ competency requirements and adapting explanations and examples to produce a 25% comprehension gain; analyzed PowerSchool performance data to identify learning gaps and risk signals, addressed 90%+ of flagged cases, and contributed to a 20% improvement in measured assessment outcomes; delivered written and verbal feedback cycles through digital platforms for 100+ active ESL learners, increasing on-time assignment completion and consistency by 30% over six months.",
      },
      {
        id: "experience-scope-boundary",
        relationship: "TRANSFERABLE",
        statement:
          "No source verifies direct SaaS Customer Success Manager employment, literal SaaS account ownership, production CRM ownership, renewal or expansion quota ownership, or direct software-product account management. HubSpot Service Hub and Pendo evidence is certification-based; these areas must remain transferable, partial, unsupported, or genuine gaps according to the job requirement and complete-profile evidence.",
      },
    ],
    skills: [
      {
        id: "skill-tools",
        statement:
          "Tools and platforms: Google Workspace, Microsoft Office, Notion, Trello, Slack, PowerSchool, IXL, Canva, ChatGPT and generative-AI prompting, HTML, CSS, JavaScript, Visual Studio Code, and GitHub.",
      },
      {
        id: "skill-hubspot-service-hub",
        statement: "Service Hub Software certification, HubSpot Academy.",
      },
      {
        id: "skill-pendo-product-analytics",
        statement: "Product Analytics certification, Pendo.",
      },
      {
        id: "skill-tefl",
        statement:
          "TQUK Level 5 Certificate for Teaching English as a Foreign Language, International TEFL Academy (October 2016-February 2017).",
      },
      {
        id: "skill-coding",
        statement: "Introduction to Coding certification, SheCodes (January 2026).",
      },
      {
        id: "skill-education",
        statement:
          "BA in History and Anthropology, Northern Illinois University; AA with Honors, Rock Valley Community College.",
      },
      {
        id: "skill-padi",
        statement: "PADI Open Water Diver certification.",
      },
    ],
    transferableSkills: [
      {
        id: "transfer-customer-engagement",
        statement:
          "Customer engagement and needs discovery through individualized consultations, preference analysis, guidance, and consistent follow-through.",
      },
      {
        id: "transfer-onboarding",
        statement:
          "Transferable onboarding and adoption support through retail enrollment guidance, value communication, learner orientation, education, and early-use support; this is not literal SaaS onboarding ownership.",
      },
      {
        id: "transfer-relationships-retention",
        statement:
          "Transferable relationship management, engagement, retention, proactive expectation-setting, and issue resolution across recurring tutoring clients, learners, and retail customers.",
      },
      {
        id: "transfer-education-enablement",
        statement:
          "Customer-education and enablement analogues through structured training, facilitation, coaching, localized content, tailored resources, and feedback cycles.",
      },
      {
        id: "transfer-insights-risk-analysis",
        statement:
          "Customer-insight and risk-identification analogues through activity-trend analysis, PowerSchool data, purchasing patterns, learning-gap diagnosis, and targeted intervention.",
      },
      {
        id: "transfer-portfolio-operations",
        statement:
          "Transferable portfolio and operations capability through management of 15-20 recurring tutoring clients, 40+ monthly sessions, multi-time-zone scheduling, service continuity, and adherence tracking.",
      },
      {
        id: "transfer-cross-cultural-communication",
        statement:
          "International and cross-cultural communication experience spanning the United States, Spain, China, and remote international clients.",
      },
      {
        id: "transfer-content-process-improvement",
        statement:
          "Documentation, content adaptation, digital-tool use, and process improvement, including a 30% reduction in manual preparation through AI-assisted materials.",
      },
    ],
    locationPreferences: {
      preferredWorkArrangement: "REMOTE",
      acceptedRemoteScopes: [
        "US_REMOTE",
        "GLOBAL_REMOTE",
        "EMEA_REMOTE",
        "EU_REMOTE",
        "DISTRIBUTED_TEAM",
      ],
      allowUnitedStatesOnlyRoles: true,
      futureInternationalEligibilityUnknownUnlessExplicit: true,
      longTermGoals: ["INTERNATIONAL_EMPLOYMENT", "EUROPEAN_RELOCATION"],
      unacceptableArrangements: [
        "ONSITE_REQUIRED",
        "MANDATORY_HYBRID",
        "INCOMPATIBLE_LOCATION_LOCK",
      ],
      timeZoneRequirementsAreDisplayedFacts: true,
    },
    compensationPreferences: {
      currency: "USD",
      passMinimum: 60_000,
      reviewMinimum: 55_000,
      belowReviewMinimumUsResidencyResult: "SKIP",
      belowReviewMinimumExplicitLowerCostResidencyResult: "CONTINUE",
      belowReviewMinimumUnclearResidencyResult: "REVIEW_OR_UNKNOWN",
      undisclosedResult: "UNKNOWN",
      competitiveSalaryResult: "UNKNOWN",
      substantiallyLowerCostCountries: [],
    },
    workPreferences: [
      {
        id: "work-remote-travel",
        statement: "Prefers fully remote work with minimal required travel.",
      },
      {
        id: "work-style",
        statement:
          "Prefers asynchronous communication, deep work, documentation, process improvement, education, cross-functional collaboration, feedback loops, and some strategic ownership.",
      },
      {
        id: "work-lower-alignment",
        statement:
          "Lower alignment with roles dominated by reactive support, call-center work, constant interruptions, meeting-heavy schedules, call-volume KPIs, or little strategic responsibility.",
      },
      {
        id: "work-travel-context",
        statement:
          "Infrequent company gatherings, conferences, and exceptional customer visits may be acceptable; recurring customer on-site work and field travel are strong mismatches.",
      },
    ],
    companyPreferences: {
      preferredBusinessModels: ["SAAS", "SOFTWARE", "TECHNOLOGY"],
      alsoAlignedBusinessModels: ["EDTECH", "MARKETPLACE", "SUBSCRIPTION"],
      preferredProductTypes: [
        "WORKFLOW",
        "PRODUCTIVITY",
        "COLLABORATION",
        "LEARNING",
        "AUTOMATION",
        "NO_CODE",
        "LOW_CODE",
      ],
      moderatelyTechnicalProductsAreContextual: true,
      developerFocusedProductsRequireRoleSpecificDeepEngineeringEvidence: true,
      customerTypes: [
        "B2C",
        "B2B2C",
        "LIGHT_B2B",
        "ENTERPRISE_HEAVY_B2B",
        "MIXED",
      ],
      customerSegments: [
        "SMB",
        "MID_MARKET",
        "COMMERCIAL",
        "ENTERPRISE",
        "MIXED",
      ],
      enterpriseConcernRequiresResponsibilityEvidence: true,
    },
    domainPreferences: { customerSuccess: customerSuccessPreferences },
  });
