# ⚖️ calculator 규칙 (KTL 정도검사 계산기)

> **공용 최상위 헌법을 따른다 → `~/coding/harness/rules/CONSTITUTION.md`**
> (보안·배포·코드품질·에이전트행동·지식그래프 공통 원칙은 거기 있음 — 여기 복붙하지 않음.)
> 이 파일은 **calculator(aicalc.work) 고유 규칙**만 담는다.
> 배포: GitHub `ktl-calculator` → aicalc.work (Vercel, icn1) / 기준: harness `01_projects.md`.

---

## 🧮 정도검사 계산 (최우선 — 오답 = 치명)

1. **`src/precision.js`는 엑셀 `Version11_(2026).xlsx` 수식과 1:1로 일치해야 한다.**
   - **드리프트 = 평균(AVERAGE)**, **반복성 = 표준편차(STDEV)**. 절대 혼동 금지.
   - 반복성: `MAX(STDEV)` 4콤보(Z5 고정 + init/fin 각 1) = 엑셀 D27/D40.
   - `ROUND` 자릿수는 엑셀 수식 그대로.
2. **판정 기준값은 `npm run sync-excel`로만 바꾼다.** `src/precision-criteria.json` 수기 수정 금지.
3. **계산·판정 변경 시 `test/precision.test.js` 통과 + 케이스 추가.**
4. **제로(Z1~Z7) 채널은 0·음수가 정상값**(스팬·측정값만 0 체크). 통과 불가 상황은 침묵 말고 **빨강 부적합**으로 표시.

---

## 🧠 지식 베이스 · 지식그래프 (AI 법령/도메인 답변 근거)

5. **지식은 `knowledge/**/*.md`에 로컬 저장**, Obsidian `[[링크]]`로 연결, 외부호출 없이 로컬 검색.
6. **연관성 = 지식그래프 가중치** — `src/buildIndex.js`(=`npm run gen:index`)가 `knowledge/search-index.json`에 엣지 가중치(코사인)·IDF 사전계산. `searchKnowledge`가 본문점수+엣지보너스로 연관노드 수집.
7. **`knowledge/` 수정 시 `npm run gen:index` 재생성**(빌드 `prebuild`에서 자동). 인덱스 없이 본문만 바꾸지 않는다.
8. **`vercel.json` includeFiles(`**/*.xlsx`, `knowledge/**/*.md`) 유지** — 서버리스에 엑셀·지식그래프 포함돼야 동작.
9. **법령 "기준일"은 현재 시행 중(오늘 이하)만 표시** — 미래 시행 예정일 제외(`api/lawChat.js`). 지식베이스 수치·기준은 고시 원문 추출값이라 임의 변경 금지.

---

## 🔑 인증 / 접속 코드 (calculator 고유)

10. 접속 코드는 **Vercel Blob(private)** 저장, `isSuperAdmin`은 ID 없는 레거시 공용 로그인에 슈퍼권한 미부여(계정별 격리), 만료 코드(10일)는 서버사이드 자동 삭제.
