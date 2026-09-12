/**
 * 구방식 판정 — 교체 작업이 다시 만들 절(`cache-index?legacy=1`)과 교체 업로드가 덮어써도 되는 파일
 * (`upload` replace)을 **같은 기준**으로 가른다.
 *
 * 1) 올라온 시각이 LEGACY_BEFORE 이전인 파일
 * 2) 구방식 음원이 그대로 다시 올라가 시각만 새로워진 파일 — LEGACY_REUPLOADED 목록에 있고 그 기록 시각
 *    이전에 올라온 것. 새 방식으로 다시 올라가면 시각이 새로워져 저절로 빠진다.
 *
 * 2026-09-12 00:36~00:37(KST) 사고: 이 PC 의 구약 교체 작업이 로컬에 남아 있던 구방식 욥기 음원을
 * '교체본'으로 다시 올렸다(voice/jobs.py new_job 이 교체 작업에도 로컬 파일을 '기존 파일'로 합격 처리하던
 * 문제 — 고침). 욥 1:1~26:1 149절 = 본문 해시 139개(같은 본문인 절이 있다). 서버 구방식 목록 9,816 → 9,677.
 * 이 목록이 없으면 그 절들은 새 방식으로 여겨져 교체 작업이 건너뛰고, 교체 업로드도 거절된다.
 *
 * 2026-09-12 두 번째 창 — 검수를 강화해(engine.py GAP_MAX, 연속 8자) 드러난 결함 절 54개. 본문 일부가
 * 통째로 빠진 채 합격 처리돼 올라가 있었다. 같은 방법으로 다시 만들어 덮어쓴다.
 */
import { LEGACY_BEFORE } from "@/lib/tts/verseText";

type ReuploadWindow = {
  /** 이 시각 이전에 올라온 파일이면 구방식으로 본다 — 새로 올리면 시각이 새로워져 저절로 빠진다 */
  before: string;
  hashes: readonly string[];
};

const LEGACY_REUPLOADED: Partial<Record<string, readonly ReuploadWindow[]>> = {
  f4: [
    {
    // 사고 워커를 멈춘 때(00:37:53 KST) 뒤로 넉넉히 — 그 사이 이 절들을 새 방식으로 올린 PC 는 없다
      before: "2026-09-11T15:40:00.000Z",
      hashes: [
        "00e47eda381ff76c8af7f7841ad41f9edf6558bb", "025098e665bea5725dd155d61523981c7b5cca9f", "037073488685299b83bf955952ed850b0027bd66",
        "05421610d4ada1772ee7b5fe1fd5a68283525df6", "08dbe8a9d841e7638afa23263ba2efe9b49ced5a", "09af33ab07eb512c73c12e79deb7981e1eb81aa7",
        "112551f334680708c2d7a205bd61dd003c066153", "1283eb122e164f906b65a0657f91f3fbe2b9fa7c", "16d85fbc68d15ec098a889a2bd92cc2be62c58e7",
        "16f7761a967e5cc1b9b0244961f82d7f36c33eae", "1817aeec287d95893ea928d9e020f737404b9388", "18448d0c224ceae5e52d7ea2f9cc244ba86ecf55",
        "1a55b97ec1df07f13c7778f5ac3b6736d75d3e6c", "1b507f75e53cccdad1c5e0f83eb0d040ca86f1c8", "1e25693c41ea35584b9f85f857faea16332068ca",
        "1f67b5e9aa7cb6ca07032c5e8d08b5667f245bef", "1fa742bbcba84692f807fa9a6cdbfc0412436e5b", "2032d3a1337cc1ad0753c04637d474eef6ea9cde",
        "204e2f9f65c333858eaefa8c2a7fbfe756ae5ea8", "20e0bc8cfd1ca95070deb4764fe82e08bfbc85f0", "2176b8c0c7e67b2ca88d6cb18ce3d694d214c8dd",
        "26d822197ea6c1263aad71d98b4f5fa226661887", "28a9767ac31e2a76e0b895cc16a4ca9de3f30fd7", "28fa8e11217a5954212769eddeea11878dd20fc9",
        "2ae037d9ae64c1ed34836aecc9d2fda80e321eb9", "2c76647975101739375cb6418f9b50091d935866", "35adca8ed8a805e45dddad456c640985f856d242",
        "39573bffbec9959f1012a690ad5b095ff9d7c749", "3b06020313bd66aff1077cdc2d780158628f0587", "3b93f0af1aea9647265267217a1c2d297531f55e",
        "3c5d00a7d4d08f4ad2d1022a590f9e8073eaaa08", "3c6f9e6c518cd7276f99945ad0421b006025d22a", "3e229ddde6b87ff832d9d927c8bf37f8d5c9adbc",
        "418524226fa9c7dd9ec5e713a1b439dea515f121", "46e16b9b5dd6dbef59064935204d8f7e00042e8d", "47fdc50a949633c9ea59ba23fb2c653f6f89773a",
        "4a14660b8c9f8c68b75a84062c701fc366baf495", "4d7f7cf3cfddaa15e66a7e97b6cfe3e61546be03", "4f2762b70ab875f96271ec1fd22bebd21a0c7c88",
        "4f97f47463933b177427df2ccb60f5a0b8e7716a", "503aae1aceb347b496efd27ef4e1022eb7645176", "513a512a12a588d2886bd372dc6c896121b1d659",
        "54dd599cdf5ab66c05e817e633ea9a78b94b4887", "58dfacbcec0a92fb4b256067ff6bbf6e0356a975", "5987ba0316fddf8c1392486570adba52a9e24d3c",
        "5a5ef981b82429c8f03ddf5761e3dec0fefd2f2e", "5b832c75cd19f2051b8ea22dce90c5f001e03272", "5c633e62889e2ec91db12d7623d98821bc98b079",
        "5cddc5f0649508091db511646ccc9c3abbea0c5e", "5e23e9e197cb96fe28266e39caddf0fe64d41f42", "615bdb83b75fb30252cb7574000da98a770fe650",
        "654b8d2dd9336649bb80200536fc29d5be725bb1", "66686e42d8e95009fbd1b60ad6a7c2f38343aac7", "68142cc5579979df8e747a7e55433c7c83c86f3e",
        "689bea7ba5ef697c5fb020b012e8059b2229364a", "68f9f55d129efe76d88efc959357499a4f61995f", "6a0b2d4c3d8c3694b67d3f5b68c286bb9a46248e",
        "6a724dea796de7a287814a45ce76a6da3a2ed00c", "6b4ac8b6b1529453163a6cba570d3d2db6bb5bca", "6d23efb55161da723884d7ae091e383a4f377603",
        "6f164983cf3483d933677bb34039354dafcda32a", "6f97f862d66bc98900a858055ea644d2986db1bb", "73094becc8278fc8bc043270141055561431e4d3",
        "736cf5d42f626f3268817db84ac2bf69bd7c1cf9", "73a6a682a7d5a2f9aec70709feb63513cf8a2828", "75c98bf1d034cccdacbc59c0e8b58383b2d22e1f",
        "795d9b938adb4064940926835a1c5c70d4f0d09b", "798a03a3d39308d13f02b32cc1f41767370f550a", "79d214fd80138f374d27d5c0d4220ca74cdb543a",
        "79f6cc1a2e0b5ee4e4d41afea817841cff2395b7", "7b0315fbb2d103117c9b8951ccaff48c2ae88c36", "7b1d7e90673e1726bae32c4288d1423739b6d759",
        "7fa62c319065908e788661de528ac98952c9c52b", "821239854e22fe638dd54e313af37856d90f60e9", "85ecdf58e25a96643c8b705e6416693f7b6c891b",
        "865c137f4a4ebb6a558c66312cce4b6383904972", "877cd2770da51a7345674e67874590e37634950f", "886fcf7fd98f23abe789e12f7f6eadebbc90ae79",
        "899d988878c5dcead25b089e830a58b9cba39f95", "9754a25b00c14f6650c6a299cb264892045b00b6", "98418d06461a73e3aeb5d6f1e25ab53771765a18",
        "9e850db5e0d029ee827413fa98efebce85e27c5c", "a19650ddb20688838f5ad74a02d958784a510be0", "a30575a79dd5ba79ad810b4e5df980a53864cd51",
        "a33401f33921bae9d247fbaa7f42aefbc2c631ea", "a493ead12a20523508739453121ac8f233926ab2", "a4ff69b2d4b2cfef0ada4013ba811b7d00825770",
        "a562063efa10e1ea41d32b3f6741ec6b063d3557", "a5daba971266429e100b607a37a6339708df2dce", "a6028d50c88bf4564df2b65bfa7dcec5d12a865b",
        "a7f3d57208ffeddd8c5152c4681fe7e662b17f77", "a8551710e9363f283b34060d32cf539826e36893", "a8b9ef269e2bf36e465ce4242ca72cf1a25e54f8",
        "a9631f9f68621cd7d93c73de21e3945b1c90c94b", "aefba2c4f71f4ec61e3974d5b481d72d8f13b246", "b00441e2a47dc432e4731541c2db561f798f220b",
        "b0a1df4884b7cdb20fef732abb7258906df51c6e", "b1ae994e8bfa2536467be54be48c38d38c6d01e4", "b28ed45d994efe6391f0bb2e6f30b9951bc4b74a",
        "b29b738914dbd0217b24a7444f493d1869ef4bc3", "b2efc48b43c746fe8b345ec1071c4c36d1a5db89", "b34b964f3867a40260896ac849c0704671991417",
        "b3f47569886072c0a61b0905b8a580f4ad9e515c", "b5cc0379ee27e5844972e2f573e61044b0b5e54f", "b6bd143f27eedceb2752686d703f44bbf219fc1b",
        "bbb1f974ee0bd8ec4d0564101fdaef06002e249e", "c12738a6c4bc46c468fd84c3335c979cf0007122", "c7d0403224d73698342269fe44dd88c37db19239",
        "caae3bf0e6b5764e4b8640dcea0a56dcab156b29", "cbb3f2df0931a039ef86aa2bafcc96d653498c2c", "cf07cc1a2a0386bc96146c60cfdb2ce47e0c9df6",
        "d08f3e374aa84d6f94eb22db131d95007613af99", "d297ca7c794c81108845bb1b7c002c4c7f3bfacc", "d64ddb0249617988ef535755cb3dbd09ce29820c",
        "d72201a59b81cd6984fb0a24842258c88f78b03d", "d72d4d93a3ecca1d05fc95d3ca81be76ea022a9d", "d77c45db9cf87859b7131d61904d9aa89de3706e",
        "da8d24b3232752c942aec7204e5a6c01902bf0ff", "dacc9fce42e506d5e64b98518a653595dfb97cdf", "dbd0f996e06b7d5cc380272e2f6e4454b3829eda",
        "df9a2cb86d99c4d1f478145b5ba7a0c14ebdc17c", "e202330b1e38c1bd978d01c790c12fa2560942a7", "e2d8a8284af8e1e427051d7e0acb0841c41902b6",
        "e4fa9b9befe3ab6bb32ccf4b5af6e8d160b00d9d", "e7647a3d3e6b09173d168795b07d7b9f3b24020f", "ea7f2426360425f14f5bbefbf19ffbda78c86ab9",
        "ea91b546baa625d27d22e827edb0a54a89b90b98", "eacdbefd366500fc3c4558b36eb2d98a332faafd", "ec731f879dad8fbb48be56654300a5c588d4a0db",
        "f003347c036c07e52e2f926155907a9ee3e76ec9", "f2090380af53c0e426139d60d7c6a9b010eda93f", "f263a52012a48e6f072a326de891b640a9e9d5aa",
        "f7e3f4872e7dea886b043bfa0a0e879197a5d407", "f90d5b0791a9c3e2ff560b5c8b2701b177df5f79", "f9b45c803dd40d95f7d7b8676bd78bc41bc439de",
        "f9eb11cc3b1bfb6e83796d26423156b0373020a5", "fa288d1c9a768d56f6be0b2c5205a54028f25142", "fa918531df0c35762b0900d2fd34798459608d99",
        "ffce97db0654d5a88ab48c26bf782e37e406c311",
      ],
    },
    {
      // 2026-09-12 검수 강화로 드러난 결함 절 54개 — 본문 일부가 **통째로 빠진 채** 올라갔다.
      // 일치율(%)만 보던 검수가 통과시킨 것이다(창세기 1:16 '또 별들도 만드셨다' 8자 누락이 90%로 합격).
      // voice/engine.py 에 '연속 8자 이상 빠지면 불합격'(GAP_MAX)을 넣어 앞으로는 걸리게 했고,
      // 이미 올라간 이 절들은 여기 적어 다시 만들어 덮어쓸 수 있게 한다.
      // 시각은 이 절들이 마지막으로 올라간 뒤(15:39 KST)로 잡았다.
      before: "2026-09-12T06:50:00.000Z",
      hashes: [
        "03f58f8eac75b83dca0e4a5b89f6bd34864f150b", "04e67282ead6270c709f641426e08c31ef9213d7", "0b1e32bfa904bb51a6c2bb2d200c0be7f25eb6dd",
        "0d4e9334de6e29f8f11aaeae0695c20a5a47c31f", "0ed14e26976e66177a55fe567314154384c8219c", "0fdf83dc6a9c3b7e2c507177988675bb9d2db31d",
        "10e108183e6f163d322593a5bd64ddf1aed849fb", "16657c84a9e10ecfc98fd9c1d01c1201f81bd9b3", "1a2f8f610a7efbe2a76a839646b2b4de2ea9fc1c",
        "27c83cbf2276a5e53ca4c4691d99542510907f7c", "2d6ddd80cbc4a5c3fd75d49eb85a10d010bd3b4f", "35cf362eba3b5538c97443e66f3ec0727863e45f",
        "3825ededb34ab07b03552d26125a90c19d71538d", "3b881804cfc3829a519935515d4fa14831cef1ef", "40871710e40e3bb22ec395417843459571b5a131",
        "414c90fa96b21cdaa143eeaeb7703ecef2efaf78", "4c96a283eaea16c5bc241b5fa2d13fc5b185885b", "4d3549c29aa6c73208a5a80d071894e0dfa1ea71",
        "54ba82e44b53a4ad14873dfc5e5b3d22e8ebf6cc", "5c4fc461c3718c1ec8bbccaee34b94f319cb0df7", "5ccb49774dc0799c4df4bc4c026665dc928f858d",
        "5e8db5993e0624c897534be46a9de7bce34d255b", "5edb91758f89aeaa8de149967ee7c53873be3e4d", "5f7dc2763f4adb63b223f950b0ef21a94416c7d2",
        "6b6d5f557fc6aba17589b13ed903116795dba7a7", "6bf0a72c1cd1a13441ea084ff5f10e5950892dc3", "6c95908f842a1be51d5c4636ec9d9f45496af4c7",
        "73d472b686f4731becedc49f11d11541205c9694", "7493703244c5f5ba981c60a9b616b68ab9e9fbab", "78c25a7e377aef3dc834164a6cc2f006a734b4cd",
        "88c82fa8ea3a4f150f2f8034def9e9cd4a29e816", "8ac76105d06e1db1b803da2ba081ffa0fa3a336f", "8eea9a2907bd84f247fcb76a819e71c2dbfdb62f",
        "9865d0826e9238c2b38d1225ebd37bfeebc9e615", "9cc98460e96e6a343135cfc86887f3dcb2e5873c", "a60b6895561f7775fbb01b542615e9dd3b695eab",
        "af52c684104b55750e3b7f2ef52e403bba626a11", "bb4abfa78e06c45a92ff41fbccdfb777b4fce7b7", "c7712503b7edb954329721d9147e64f7f55daaf1",
        "d215863fb051ebb93d1d3684e0abef0bd1a67e23", "d31ad4fcb9c7ced7a0e5393f5c48071d05a4a16c", "d4dd63e5a3507d335df99fe549c24ec85036f356",
        "d6f1f54bef10ce271db57c28a60da2237ab0d080", "db2ea4e53cf105e36bcaed600cc9bd8c2794c8d7", "e1a4042e2b8b3d9a3af9d6322edb5498a6de5c60",
        "e35238a9b6bcd9f66cede9368d7e49e92f03b85b", "ecf02e1428608059e2c71483429d01eba2b32d13", "eed055ed1c032831fe74c655106b644bb3974950",
        "ef5b54fd8d96251922a90b111daf455a04274b97", "f05eec1d4a7acc34ee0cae15c24ab8a099d833fd", "f6dcf4b31016b2151389e770aa849c8b4553ddf2",
        "f70ddf712d46ff3787a722b4cc61471ad6c45950", "f80be2feaee916b9c4219863b80abba129e79068", "f91f07894388631af3b4faf0a2c0914d3fa4496a",
      ],
    },
  ],
};

const sets = new Map<string, Set<string>[]>();

function hashSets(voiceKey: string): Set<string>[] {
  let list = sets.get(voiceKey);
  if (!list) {
    list = (LEGACY_REUPLOADED[voiceKey] || []).map((w) => new Set(w.hashes));
    sets.set(voiceKey, list);
  }
  return list;
}

/** 이 성우 슬롯에 구방식 기준 시각이 있는가 */
export function hasLegacyCutoff(voiceKey: string): boolean {
  return Number.isFinite(Date.parse(LEGACY_BEFORE[voiceKey] || ""));
}

/** 캐시 키(`tts/v1/ko/f4/<sha1>.mp3`)의 본문 해시 */
export function keyHash(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1).replace(/\.mp3$/, "");
}

/** 이 파일(본문 해시·올라온 시각)이 아직 구방식인가 */
export function isLegacyFile(voiceKey: string, hash: string, lastModified: Date | undefined): boolean {
  if (!lastModified) return false;
  const t = lastModified.getTime();
  const cutoff = Date.parse(LEGACY_BEFORE[voiceKey] || "");
  if (Number.isFinite(cutoff) && t < cutoff) return true;
  const windows = LEGACY_REUPLOADED[voiceKey] || [];
  const forKey = hashSets(voiceKey);
  return windows.some((w, i) => t < Date.parse(w.before) && forKey[i].has(hash));
}
