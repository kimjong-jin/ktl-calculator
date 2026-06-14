# ⚖️ CONSTITUTION — calculator (KTL 정도검사 계산기) 절대 규칙

> 이 파일의 규칙은 어떤 상황에서도 예외 없이 적용된다.
> AI 에이전트·개발자·자동화 스크립트 모두 동일하게 따른다.
> 배포처: **aicalc.work** (GitHub `ktl-calculator` → Vercel 자동배포, region icn1)

---

## 🔴 보안 (절대 위반 금지)

1. **`.env.local`·시크릿은 절대 git에 커밋하지 않는다** — gitignore 유지, 변경 금지.
2. **모든 키·시크릿은 서버사이드(`process.env.*`)에서만 쓴다.**
   - `GEMINI_API_KEY` · `ADMIN_PASSWORD` · `ADMIN_ID` · `AUTH_SECRET` · `BLOB_READ_WRITE_TOKEN` · `ACCESS_PASSWORD` · `ADMIN_SKILL_CONTEXT`
   - 클라이언트 코드(`web/*.js`, `src/` 중 번들 대상)에 키 하드코딩 금지.
   - 외부 API 호출(Gemini 등)은 반드시 `api/*.js` 서버 함수를 경유한다.
3. **사용자에게 내부 에러·스택을 노출하지 않는다.**
   ```js
   // ❌  res.status(500).json({ error: e.stack });
   // ✅  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
   ```
4. **접속 코드·인증은 계정별로 격리한다.**
   - Vercel Blob(private)에 저장, `isSuperAdmin`은 ID 없는 레거시 공용 로그인에 슈퍼권한을 주지 않는다.
   - 만료 코드는 서버사이드에서 자동 삭제(10일 만료).
5. **입력값을 신뢰하지 않는다** — 요청 파라미터는 화이트리스트·범위 검증 후 사용.

---

## 🟡 배포 규칙

6. **aicalc.work 배포는 `git push`로만 한다.** `vercel --prod` 직접 실행은 비상시에만.
7. **배포 전 반드시 빌드+테스트를 통과시킨다.**
   ```bash
   npm test        # smoke.test.js + precision.test.js (42+)
   npm run build   # prebuild = genClaydoxJson + buildIndex 자동 실행
   ```
   - `prebuild`가 `search-index.json`을 재생성하므로 빌드 실패 = 배포 불가.
8. **`vercel.json`의 함수 includeFiles(`**/*.xlsx`, `knowledge/**/*.md`)를 제거하지 않는다** — 지식베이스·기준 엑셀이 서버리스에 포함돼야 동작한다.

---

## 🧮 정도검사 계산 (도메인 — 최우선, 오답 = 치명)

9. **계산 엔진 `src/precision.js`는 엑셀 `Version11_(2026).xlsx` 수식과 1:1로 일치해야 한다.**
   - **드리프트 = 평균(AVERAGE) 기반**, **반복성 = 표준편차(STDEV) 기반**. 둘을 절대 혼동하지 않는다.
   - 반복성: `MAX(STDEV)` 4콤보(Z5 고정 + init/fin 각 1) — 엑셀 D27/D40과 동일.
   - `ROUND` 자릿수는 엑셀 수식 그대로(반복성·드리프트·직선성 각 1자리 등).
10. **판정 기준값은 `npm run sync-excel`로만 바꾼다.** `src/precision-criteria.json`을 손으로 수정 금지(엑셀에서 자동 추출).
11. **계산·판정 로직을 바꾸면 `test/precision.test.js`를 통과시키고, 필요한 케이스를 추가한다.**
12. **제로(Z1~Z7) 채널은 0·음수가 정상값이다** — 0/음수를 일괄 부적합 처리하지 않는다(스팬·측정값만 0 체크). 통과 불가 상황은 침묵하지 말고 **명확히 부적합(빨강)으로 표시**한다.

---

## 🧠 지식 베이스 · 지식그래프 (AI 법령/도메인 답변의 근거)

13. **도메인·법령 지식은 `knowledge/**/*.md`에 로컬로 저장한다.** Obsidian 스타일 `[[링크]]`로 노드를 연결하고, 외부 호출 없이 로컬에서 검색·활용한다.
14. **연관성은 지식그래프 가중치로 계산한다.**
    - `src/buildIndex.js`(=`npm run gen:index`)가 `knowledge/search-index.json`에 **엣지 가중치(코사인 유사도)·IDF**를 사전 계산한다.
    - `searchKnowledge`는 본문 점수 + 엣지 가중치 보너스로 연관 노드를 끌어온다.
15. **`knowledge/`를 수정하면 인덱스를 재생성한다** — `npm run gen:index`(빌드 시 `prebuild`로 자동). 인덱스 없이 본문만 바꾸면 가중치가 어긋난다.
16. **법령 "기준일"은 현재 시행 중(오늘 이하)만 표시한다** — 미래 시행 예정일은 라벨에서 제외(`api/lawChat.js`). 지식베이스 수치·기준은 고시 원문에서 추출한 것이며 임의 변경 금지.

---

## 🟢 코드 품질

17. **MD 파일은 200줄을 넘기지 않는다** — 초과 시 분리.
18. **`any` 타입 금지** — 불가피하면 `// eslint-disable-next-line` 주석 필수.
19. **Promise를 무시하지 않는다** — `await` 또는 `void fn().catch(...)`.
20. **콘솔 로그는 `[서비스명] 메시지` 형식으로 구조화한다.**
    ```js
    console.warn('[lawChat] 지식베이스 미스:', q);
    console.error('[precision] 기준값 로드 실패:', e);
    ```
