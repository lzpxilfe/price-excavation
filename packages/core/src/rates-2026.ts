import type {
  InvestigationStage,
  InvestigatorRole,
  RateSet,
  RateSourceMetadata,
  WorkforceRole,
} from "./types.ts";

export const OFFICIAL_RATE_SOURCE_2026: RateSourceMetadata = {
  id: "khs-buried-heritage-fee-2026-2",
  title: "매장유산 조사용역 대가의 기준",
  authority: "국가유산청",
  noticeNumber: "국가유산청고시 제2026-2호",
  publishedOn: "2026-01-05",
  effectiveFrom: "2026-01-11",
  effectiveTo: "2026-12-31",
  url: "https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000271724&chrClsCd=010201",
  checksumSha256: "1e2cbd4aeafff8b33f862ea47ea7463db47bbfc1f98313b6b23b5da3fd544264",
  status: "published",
  notes: [
    "별표 4(시굴), 별표 5(정밀), 별표 7(2026 조사인력 기준단가), 별표 8(직접경비)을 전사했다.",
    "기준단가에는 법정 보험료와 퇴직적립금이 포함되며 주휴수당은 별도로 산출한다.",
  ],
};

export const CONSTRUCTION_LABOR_SOURCE_2026_H1: RateSourceMetadata = {
  id: "cak-construction-wage-2026-h1",
  title: "2026년 상반기 적용 건설업 임금실태조사 보고서",
  authority: "대한건설협회",
  noticeNumber: "통계청 승인번호 제365004호",
  publishedOn: "2026-01-01",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-08-31",
  url: "https://www.cak.or.kr/lay1/bbs/S1T9C12/A/2/view.do?article_seq=153489",
  checksumSha256: "not-bundled-source-document",
  status: "reviewed",
  notes: ["보통인부 1일 노임 172,068원을 적용했다. 하반기 공표 시 새 RateSet으로 교체해야 한다."],
};

export const RATE_SET_2026: RateSet = {
  id: "kr-buried-heritage-2026-h1",
  label: "2026년 매장유산 조사용역 대가·상반기 보통인부",
  effectiveFrom: "2026-01-11",
  effectiveTo: "2026-08-31",
  currency: "KRW",
  unit: "person_day",
  region: "KR",
  vatIncluded: false,
  status: "published",
  investigatorDailyRatesKrw: {
    director: 372_878,
    supervisor: 287_556,
    researcher: 251_866,
    assistantResearcher: 171_281,
    assistant: 137_111,
  },
  laborerDailyRateKrw: 172_068,
  directExpenseRatios: {
    trial: { min: 1.9, max: 2.3 },
    precision: { min: 2.2, max: 2.4 },
  },
  overheadRatio: { min: 1, max: 1.1 },
  academicFeeRatio: { min: 0.2, max: 0.3 },
  sources: [OFFICIAL_RATE_SOURCE_2026, CONSTRUCTION_LABOR_SOURCE_2026_H1],
};

export const INVESTIGATOR_DAILY_RATES_2026: Record<InvestigatorRole, number> = {
  ...RATE_SET_2026.investigatorDailyRatesKrw,
};

export const LABORER_DAILY_RATE_2026_H1 = RATE_SET_2026.laborerDailyRateKrw;

export const INVESTIGATION_STAGES: readonly InvestigationStage[] = [
  "preparation",
  "topsoilRemoval",
  "featureExposure",
  "featureExcavation",
  "recording",
  "closeout",
];

export type StandardCoefficientRow = {
  areaM2: number;
  coefficients: readonly [number, number, number, number, number, number];
};

const trial = (
  areaM2: number,
  preparation: number,
  featureExposure: number,
  recording: number,
  closeout: number,
): StandardCoefficientRow => ({
  areaM2,
  coefficients: [preparation, 0, featureExposure, 0, recording, closeout],
});

const precision = (
  areaM2: number,
  ...coefficients: [number, number, number, number, number, number]
): StandardCoefficientRow => ({ areaM2, coefficients });

export const TRIAL_STANDARD_COEFFICIENTS_2026: Record<WorkforceRole, readonly StandardCoefficientRow[]> = {
  director: [
    trial(440, .000401, .001871, .000134, .000134),
    trial(3_191, .000081, .000251, .000027, .000072),
    trial(7_169, .000050, .000162, .000017, .000039),
    trial(16_655, .000025, .000106, .000015, .000011),
    trial(41_611, .000014, .000063, .000013, .000009),
    trial(70_448, .000009, .000055, .000009, .000007),
    trial(205_452, .000008, .000025, .000008, .000006),
    trial(480_758, .000006, .000020, .000006, .000005),
    trial(802_865, .000005, .000014, .000005, .000003),
    trial(1_124_973, .000004, .000013, .000004, .000003),
  ],
  supervisor: [
    trial(440, .001470, .003475, .000401, .000802),
    trial(3_191, .000152, .000645, .000283, .000098),
    trial(7_169, .000100, .000480, .000112, .000056),
    trial(16_655, .000043, .000285, .000063, .000023),
    trial(41_611, .000023, .000199, .000039, .000009),
    trial(70_448, .000013, .000132, .000021, .000006),
    trial(205_452, .000009, .000099, .000011, .000007),
    trial(480_758, .000007, .000076, .000008, .000005),
    trial(802_865, .000005, .000057, .000006, .000004),
    trial(1_124_973, .000005, .000055, .000006, .000004),
  ],
  researcher: [
    trial(440, .001871, .006949, .002138, .001336),
    trial(3_191, .000242, .001441, .000260, .000197),
    trial(7_169, .000119, .000815, .000190, .000090),
    trial(16_655, .000074, .000722, .000124, .000044),
    trial(41_611, .000043, .000650, .000086, .000014),
    trial(70_448, .000028, .000488, .000063, .000014),
    trial(205_452, .000018, .000402, .000041, .000010),
    trial(480_758, .000015, .000330, .000034, .000008),
    trial(802_865, .000012, .000267, .000027, .000007),
    trial(1_124_973, .000012, .000260, .000027, .000006),
  ],
  assistantResearcher: [
    trial(440, .000535, .002940, .002806, .000401),
    trial(3_191, .000212, .002094, .000241, .000212),
    trial(7_169, .000175, .000870, .000202, .000175),
    trial(16_655, .000079, .000664, .000188, .000142),
    trial(41_611, .000073, .000634, .000152, .000120),
    trial(70_448, .000066, .000440, .000092, .000055),
    trial(205_452, .000040, .000376, .000080, .000032),
    trial(480_758, .000039, .000365, .000078, .000031),
    trial(802_865, .000035, .000332, .000071, .000028),
    trial(1_124_973, .000033, .000306, .000065, .000026),
  ],
  assistant: [
    trial(440, 0, 0, 0, 0),
    trial(3_191, .000098, .000654, .000125, .000087),
    trial(7_169, .000039, .000519, .000045, .000076),
    trial(16_655, .000059, .000477, .000074, .000050),
    trial(41_611, .000034, .000365, .000047, .000030),
    trial(70_448, .000010, .000353, .000028, .000004),
    trial(205_452, .000008, .000296, .000024, .000003),
    trial(480_758, .000008, .000293, .000024, .000003),
    trial(802_865, .000007, .000273, .000022, .000003),
    trial(1_124_973, .000007, .000252, .000020, .000003),
  ],
  laborer: [
    trial(440, .006014, .038354, .002138, .004811),
    trial(3_191, .001737, .011594, .001397, .001594),
    trial(7_169, .001527, .006944, .001297, .000845),
    trial(16_655, .001025, .004486, .001060, .000942),
    trial(41_611, .000710, .004070, .000717, .000655),
    trial(70_448, .000373, .003671, .000353, .000328),
    trial(205_452, .000252, .003523, .000242, .000236),
    trial(480_758, .000227, .003171, .000218, .000212),
    trial(802_865, .000195, .002727, .000187, .000183),
    trial(1_124_973, .000186, .002600, .000179, .000174),
  ],
};

export const PRECISION_STANDARD_COEFFICIENTS_2026: Record<WorkforceRole, readonly StandardCoefficientRow[]> = {
  director: [
    precision(422, 0, .000296, .001630, .004741, .000148, 0),
    precision(2_642, .000110, .000244, .000549, .001257, .000143, .000063),
    precision(7_154, .000076, .000099, .000309, .000844, .000103, .000041),
    precision(18_767, .000066, .000097, .000185, .000611, .000074, .000040),
    precision(39_768, .000048, .000093, .000158, .000350, .000052, .000037),
    precision(98_625, .000035, .000067, .000114, .000252, .000043, .000035),
    precision(244_589, .000025, .000048, .000082, .000181, .000031, .000025),
  ],
  supervisor: [
    precision(422, .001333, .002222, .003259, .010963, .001926, .001481),
    precision(2_642, .000366, .000635, .001209, .002674, .001025, .000208),
    precision(7_154, .000186, .000355, .000903, .002219, .000885, .000146),
    precision(18_767, .000067, .000354, .000599, .001231, .000488, .000050),
    precision(39_768, .000049, .000321, .000527, .000904, .000386, .000054),
    precision(98_625, .000037, .000241, .000395, .000678, .000290, .000041),
    precision(244_589, .000028, .000181, .000296, .000509, .000217, .000030),
  ],
  researcher: [
    precision(422, .002963, .004741, .006815, .017778, .006519, .002963),
    precision(2_642, .000647, .002198, .003406, .006641, .002014, .000586),
    precision(7_154, .000588, .001002, .001974, .004147, .001788, .000430),
    precision(18_767, .000517, .000945, .001352, .002633, .001397, .000397),
    precision(39_768, .000383, .000805, .001383, .001947, .000865, .000337),
    precision(98_625, .000283, .000596, .001023, .001441, .000640, .000249),
    precision(244_589, .000210, .000441, .000757, .001066, .000474, .000185),
  ],
  assistantResearcher: [
    precision(422, .003556, .004741, .005778, .015259, .006815, .001185),
    precision(2_642, .000720, .001331, .003162, .006300, .005511, .000972),
    precision(7_154, .000587, .000964, .001989, .003986, .002862, .000753),
    precision(18_767, .000551, .000938, .001927, .003377, .001786, .000672),
    precision(39_768, .000485, .000892, .001893, .002303, .001082, .000464),
    precision(98_625, .000398, .000731, .001799, .001888, .000887, .000380),
    precision(244_589, .000326, .000600, .001475, .001549, .000728, .000312),
  ],
  assistant: [
    precision(422, .003244, .005614, .003836, .007392, .005170, .003244),
    precision(2_642, .000930, .001687, .002407, .004372, .004484, .000893),
    precision(7_154, .000539, .001149, .001897, .003734, .003080, .000375),
    precision(18_767, .000109, .001288, .001786, .003166, .002584, .000149),
    precision(39_768, 0, .000956, .001250, .002954, .001688, 0),
    precision(98_625, 0, .000793, .001038, .002452, .001401, 0),
    precision(244_589, 0, .000659, .000861, .002035, .001163, 0),
  ],
  laborer: [
    precision(422, .021926, .036889, .064741, .131852, .026667, .020741),
    precision(2_642, .004407, .013002, .037285, .063936, .006800, .004554),
    precision(7_154, .003885, .012721, .028265, .048980, .005830, .001934),
    precision(18_767, .003477, .010921, .024416, .046698, .004145, .000942),
    precision(39_768, .002740, .011738, .022656, .027071, .002887, .005139),
    precision(98_625, .002329, .009977, .019258, .023010, .002130, .004368),
    precision(244_589, .001980, .008481, .016369, .019559, .001231, .003713),
  ],
};

export const REPORT_WORK_MULTIPLIERS_2026: Record<
  "trial" | "precision",
  Record<WorkforceRole, number>
> = {
  trial: {
    director: .2,
    supervisor: .3,
    researcher: .2,
    assistantResearcher: .2,
    assistant: .2,
    laborer: 0,
  },
  precision: {
    director: .7,
    supervisor: 1.3,
    researcher: 1,
    assistantResearcher: .9,
    assistant: .8,
    laborer: .4,
  },
};
