# Rulegen 요구사항 V2

업데이트 날짜: 2026-10-07

**현재 범위: Spatial constraint / Stylistic constraint / Object, 추출 합계 최대 7개, constraint는 move만, 원본 reconstruction 유지. 최신 수정은 22~24번이 우선합니다.**

`updated.md`의 전체 내용을 아래에 보존하고, 이번 대화에서 추가·수정한 요구사항을 마지막 **V2 변경 사항**에 반영했습니다. 서로 충돌하는 내용은 V2 변경 사항이 우선합니다. 특히 기존 14번의 알고리즘 펜·Compose workflow는 기록으로 남기며, 현재 요구사항에서는 constraint 안에 알고리즘을 연결하고 스케치에서 직접 조작하는 workflow로 대체합니다. 일반 연필 스케치와 procedural brush는 계속 지원합니다.

---

# Overview
hand drawn sketch를 creative coding을 translate할 때 exploration하면서 할 수 있도록 돕는 툴임

# 핵심 기능
- 기본 스케치
  - 연필 툴(색, 굵기, 투명도 변경), 지우개 툴, undo/redo, pan zoom
- Analyze 스케치
  - 라쏘툴로 특정 부분 선택하고 Generate
  - analyze를 하면 스케치 노드 자체에 먼저 visual feature에 대한 tag가 달렸으면 좋겠어
    - 이미지의 복잡도에 따라 2~6개
    - 거기에는 visual feature이 짧막하게 적혀있음
      - e.g. 반복적으로 뻗는 나무가지
      - e.g. 갈색
    - visual feature는 텍스트이고 사용자가 수정 버튼 눌러서 텍스트를 직접 수정할 수 있음
  - 특정 태그를 클릭한 후 generate rule하면 그 visual 특징을 생성하는 rule들이 생성이됨
    - rule은 subfeature + 구현 방식 + 파라미터 widget으로 구성하며, 구현 방식과 값을 수정하고 generate alternative도 할 수 있어야함
    - rule을 refine한다음에 generate code하면 코드가 생성되고 visual을 확인할 수 있음
  



---

# 추가 요청 및 업데이트된 요구사항

업데이트 날짜: 2026-10-06

위 내용은 `init.md` 원문이며, 아래는 이후 대화에서 요청한 내용을 정리한 업데이트입니다. 초기에는 디자인을 탐색하는 UI 껍데기로 시작했지만, 최종 목표는 실제 스케치·LLM 생성·p5.js 실행이 가능한 앱입니다.

## 1. 작업 공간과 스케치

- 작업 공간을 freeform 무한 캔버스로 구성한다. 캔버스를 이동·확대·축소하고, 프레임을 자유롭게 배치할 수 있어야 한다.
- 원본 스케치와 생성 결과를 서로 다른 프레임에 표시한다. 생성한 p5.js 코드의 실행 결과는 별도의 결과 프레임에 나타난다.
- 원본 스케치 프레임에도 흰색 배경을 적용한다.
- 직접 스케치하는 입력뿐 아니라 사진 첨부를 지원한다.
- 사진은 파일 업로드와 클립보드 이미지 붙여넣기로 첨부할 수 있어야 한다.

## 2. 툴바와 연필 메뉴

- 작업 도구와 캔버스 조작 도구는 왼쪽 툴바에 모은다.
- 연필의 색상·굵기·투명도 메뉴는 연필을 눌렀을 때만 표시한다.
- 연필 메뉴는 연필 버튼 옆에 팝오버로 나타난다.

## 3. Visual feature 분석과 오버레이

- 분석 결과의 visual feature 개수는 고정 6개가 아니라 이미지 복잡도에 따라 2~6개로 정한다.
- Feature 태그는 스케치 위에서 해당 특징이 있는 영역 근처에 표시한다.
- 태그와 함께 영역 표시·중심점·연결선 등의 visualization을 제공해 어떤 부분을 가리키는지 알 수 있게 한다.
- 표시되는 영역끼리는 겹쳐도 되지만, 태그 자체는 서로 겹치지 않도록 배치한다.
- 확대·축소와 태그 선택 시에도 태그 간 겹침을 피하고 프레임 안에서 읽을 수 있도록 배치한다.
- 선택한 태그와 해당 영역, 연결선은 더 강하게 강조한다.
- 선택한 태그가 있으면 나머지 태그와 영역, 연결선은 많이 fade 처리한다.
- Feature의 텍스트는 사용자가 수정할 수 있어야 한다.

## 4. Feature 선택과 Rules 동기화

- 선택한 visual feature에 맞춰 Rules 패널을 동기화한다.
- Feature를 선택하면 그 feature에 관련된 subfeature와 위젯만 표시한다.
- 아무 feature도 선택하지 않았으면 전체 Rules를 표시한다.

## 5. Rules의 구성과 파라미터 위젯

- 읽기 어려운 규칙 설명 중심의 UI 대신 **subfeature + 구현 방식 + 파라미터 widget**으로 구성한다.
- 각 subfeature에서 구현 방식을 선택하고 그 방식에 맞는 파라미터를 조절할 수 있어야 한다.
- 예를 들어 구불구불한 wave feature는 curvy shape, color, wave 감쇠 등의 subfeature로 나눌 수 있다. Curvy shape에서 sine을 선택하면 amplitude, cycles, phase 같은 관련 값을 조절한다.
- Rules의 위젯 값과 실제 코드 파라미터를 연결한다. 위젯 값이 바뀌면 코드와 p5.js 결과가 즉시 갱신되어야 한다.
- 단순 파라미터 변경은 매번 LLM을 호출하지 않고 연결된 코드 값을 갱신한다.
- 구현 방식 변경이나 재생성으로 위젯 구성이 달라지면 필요한 코드 연결을 갱신한다.
- Rules 화면의 `Choose the logic. Shape the result.` 제목을 제거한다.
- `Subfeatures of … Choose an implementation, adjust its controls…` 안내 설명도 제거한다.

## 6. 개별 재생성과 삭제

- 전체 Rules를 다시 생성하는 것 외에 subfeature 카드 단위로 `Regenerate`할 수 있어야 한다.
- 해당 카드의 구현 방식과 위젯을 재생성하고, 다른 카드의 설정과 파라미터 값은 유지한다.
- 재생성된 위젯도 실제 코드와 결과에 다시 연결한다.
- Rules에서 subfeature 카드 전체와 개별 파라미터 위젯을 삭제할 수 있게 한다.
- 삭제한 항목을 되돌릴 수 있도록 `Undo deletion`을 제공한다.
- 삭제 상태는 프로젝트 저장에 반영한다. 위젯을 삭제할 때 기존 그림은 현재 값으로 유지하고, 남아 있는 위젯의 코드 연결은 계속 동작하도록 한다.

## 7. Procedural brush

- 분석한 visual feature를 이용해 procedural brush를 생성할 수 있는 UI와 실제 생성 기능을 제공한다.
- Feature 선택 및 관련 Rules를 브러시 생성에 활용한다.
- 사용자가 브러시에 대한 설명을 입력하고, feature 정보와 설명을 함께 사용해 브러시를 생성할 수 있어야 한다.
- 생성한 브러시를 미리 보고 실제 스케치에 사용할 수 있어야 한다.

## 8. 실제 엔진과 LLM 연결

- UI 시안에 머무르지 않고 기능이 실제로 동작하는 앱으로 구현한다.
- 스케치와 생성 결과 실행에는 p5.js 엔진을 사용한다.
- Feature 분석, Rules·subfeature 생성 및 재생성, 코드 생성, procedural brush 생성에는 실제 LLM을 연결한다.
- 프로젝트의 환경 파일 설정을 서버 코드에서 읽어 사용하며, API 키를 브라우저에 노출하지 않는다.
- 앱에서 사용하는 LLM 모델은 **`gpt-6.1-sol`**로 설정한다.

## 9. 생성 결과 위 자유 스케치와 수정 제안

- Generated result 프레임 위에도 annotation 스케치를 그릴 수 있어야 한다.
- Annotation에 번호나 획별 설명을 붙이지 않고 자유롭게 스케치한다.
- 결과 위 annotation에서도 지우개, Undo, Redo와 전체 지우기를 지원한다. 생성 결과 자체는 유지한다.
- 최종 흐름은 **자유 스케치 → AI Text clarification → 사용자 확인·수정 → rule·visual feature suggestion → Confirm 적용**이다.
- Clarification은 사용자가 처음부터 작성하는 것이 아니라, AI가 annotation 전후 결과 이미지를 비교하고 스케치 의도를 해석해 자동으로 작성한다.
- AI가 작성한 설명은 편집 가능한 입력창에 표시하고 사용자가 자유롭게 수정할 수 있어야 한다.
- 스케치를 변경한 뒤 AI 설명을 다시 생성할 수도 있다. 기존 설명을 수정해 사용할 수도 있다.
- Suggestion은 기존 rule widget이나 visual feature의 변경뿐 아니라 새로운 visual feature, rule, subfeature 또는 widget 추가도 포함할 수 있다.
- 제안에는 변경·추가·삭제 구분과 Before/After를 표시한다. Confirm 전에는 실제 features, rules와 결과를 변경하지 않는다.
- Confirm하면 검토한 feature·widget 변경안에 맞춰 p5.js 코드와 결과를 갱신한다. 새 항목도 결과 코드에 반영하고 widget 연결을 유지한다.
- Annotation 스케치나 clarification이 바뀌면 이전 suggestion을 다시 요청해야 한다.

## 10. 여러 스케치 프레임

- 왼쪽 툴바에 새로운 스케치 프레임을 추가하는 버튼을 제공한다.
- 추가 프레임은 독립적인 그림, 사진과 Undo/Redo 기록을 가진다.
- 선택한 프레임을 분석할 수 있고, visual feature 태그는 분석한 스케치 프레임에 표시한다.
- 여러 프레임의 그림·사진과 프레임 위치는 프로젝트 저장·내보내기·불러오기에 포함한다.

## 11. 선택 프레임에 사진 붙여넣기와 하이라이트

- 사진 붙여넣기는 무조건 첫 번째 프레임이 아니라 **현재 선택된 스케치 프레임**에 적용한다.
- 사진 첨부도 같은 선택 프레임을 사용한다.
- 스케치 표면, 프레임 제목 또는 Focus 버튼을 클릭해 해당 스케치 프레임을 선택할 수 있다.
- 선택된 프레임의 테두리와 제목을 초록색으로 하이라이트해 붙여넣기 대상을 확인할 수 있게 한다.
- 붙여넣기는 해당 프레임의 Undo/Redo에 포함한다. 다른 프레임의 그림·사진은 유지한다.
- 텍스트 입력창에서는 일반 텍스트 붙여넣기를 유지한다.
- 사진을 붙여넣은 프레임도 스케치·분석할 수 있어야 한다.

위 9~11번은 이번 채팅에서 확정한 기능 요청과 반영 내용을 정리한 것이며, 오류 보고와 오류 수정 대화는 제외했다.

## 12. 스케치별 우측 패널

- 각 스케치 프레임의 우측 패널 상태를 독립적으로 관리한다. 스케치를 선택하면 해당 스케치의 패널로 전환한다.
- Features와 편집한 이름, 선택된 feature, Rules와 구현 방식·widget 값, 생성 코드와 실행 결과를 스케치별로 보관한다.
- 마지막에 열었던 Features / Rules / Code / Brush 탭, Generation direction, 편집 중인 코드 초안, 브러시와 설명·설정도 각각 유지한다.
- 여러 스케치의 feature 태그를 각자의 프레임에 표시하며, 태그를 선택하면 해당 스케치의 패널과 연결한다.
- 각 스케치에는 별도의 결과 프레임을 연결해 여러 생성 결과를 동시에 표시한다.
- Annotation·clarification 초안과 관련 Undo/Redo도 작업 중에는 스케치별로 유지한다.
- 스케치별 패널 데이터와 선택한 스케치를 프로젝트 저장·내보내기·불러오기에 포함한다. 기존 프로젝트의 공통 패널 데이터는 원래 분석했던 스케치에 연결해 복원한다.

## 13. 스케치별 generated result

- 각 스케치의 generated result를 독립적인 프레임으로 생성해 여러 결과를 동시에 확인한다.
- 추가한 스케치에서 처음 코드를 생성하면 해당 스케치 아래에 결과 프레임을 만들고 그 결과로 화면을 이동한다.
- 결과 프레임을 클릭하면 연결된 스케치를 선택하고 해당 스케치의 우측 패널을 연다.
- Widget 조절, 코드 수정, Run again과 결과 annotation·Erase·Undo/Redo는 연결된 스케치의 결과에만 적용한다.
- 결과 프레임을 각각 이동할 수 있으며, 생성 코드와 프레임 위치는 프로젝트 저장·내보내기·불러오기 후에도 유지한다.

## 14. 알고리즘 의미를 담은 freeform 펜과 prompt composition

- Rule의 **Make pen**을 누르면 선택한 알고리즘의 의미와 현재 파라미터를 복사해 색이 다른 일반 연필 펜을 툴바에 바로 추가한다. 이 단계는 AI 생성 없이 동작한다.
- 펜은 자유로운 선을 그리며, 그릴 때 power 함수나 procedural stamp를 캔버스에 실행하지 않는다. 각 획에 원래 feature·rule·선택한 알고리즘·파라미터·사용자가 편집한 semantic을 저장한다.
- 여러 알고리즘 펜 자국과 일반 Pencil 자국으로 모양·배치·관계를 대략 스케치한다. 펜의 색은 어떤 알고리즘 의미를 담았는지 구분하는 표시다.
- **Compose prompt**에서 자국들을 어떻게 조합할지 설명한 뒤 **Compose sketch**를 누른다. AI가 전체 스케치 이미지, 순서가 있는 펜·연필·지우개 자국, 획마다 보관한 semantic과 prompt를 함께 해석해 해당 스케치의 generated result를 만든다.
- Compose prompt가 비어 있을 때 **Compose sketch**를 누르면 AI가 먼저 스케치 이미지와 각 획의 알고리즘 의미를 인식해 prompt 초안을 자동으로 채운다. 사용자는 설명을 확인·수정하고 다시 Compose sketch를 눌러 결과를 생성한다.
- **AI prompt 만들기 / AI prompt 다시 만들기**로 설명만 생성하거나 갱신할 수 있다. 기존 설명의 의도도 AI에 전달하며, 요청 중 사용자가 수정한 prompt는 덮어쓰지 않는다. prompt는 스케치별로 저장하고 자동 작성 요청도 AI 생성 로그에 기록한다.
- 예: 크기가 작아지는 패턴의 power 알고리즘을 펜에 담고, 그 펜으로 점점 커지는 모양을 자유롭게 그린다. Pencil로 배치를 잡거나 다른 알고리즘 펜으로 관계를 추가하고, prompt로 "같은 power 함수의 exponent를 사용해 커지는 패턴을 연필 경로에 배치"하도록 요청한다.
- 펜 semantic과 색은 툴바 설정에서 수정할 수 있다. 이미 그린 획은 그릴 때의 semantic을 유지하며, 펜을 툴바에서 제거해도 기존 자국의 의미는 Compose에 전달한다.
- Erase·Undo·Redo를 지원하고, 펜 목록과 획의 semantic은 프로젝트 저장·내보내기·불러오기에 포함한다. Compose prompt와 결과는 스케치별로 따로 보관한다.
- 이전 procedural 알고리즘 펜 형식의 프로젝트도 원래 알고리즘 정보를 보관한 freeform 펜으로 복원한다.

## 15. 모든 AI 생성 로그 저장

- 모든 AI 생성 요청을 서버의 `ai-generations` 폴더에 날짜·생성 종류·고유 ID별로 저장한다. 분석, rule·subfeature, clarification, suggestion, 코드·브러시, Compose와 AI 재생성·수정을 포함한다.
- 입력 이미지와 사용자 입력, AI에 보낸 prompt, 원본 응답, 최종 검증 결과를 함께 보관한다. 생성 코드는 별도 `generated.js` 파일로도 저장한다.
- 모델, 생성 시간, 상태, 소요 시간과 제공된 token 사용량을 기록한다. 실패·취소도 기록하고, 서버가 중단된 요청은 시작 상태로 남는다.
- API 키와 인증 헤더는 저장하지 않으며 로그 폴더는 Git에서 제외한다. `RULEGEN_AI_LOG_DIR`로 저장 위치를 변경할 수 있다.
- Make pen, widget 조절처럼 AI를 호출하지 않는 로컬 편집은 AI 생성 로그에 포함하지 않는다.

## 주요 사용 흐름

1. 무한 캔버스에서 스케치 프레임을 선택해 그림을 그리거나 사진을 업로드·붙여넣기 한다. 툴바에서 새 스케치 프레임을 추가할 수 있다.
2. 전체 이미지 또는 라쏘로 선택한 부분을 분석해 2~6개의 visual feature를 얻는다.
3. 겹치지 않게 배치된 오버레이 태그에서 feature를 선택한다. 선택한 태그와 영역은 강조되고 나머지는 흐려진다.
4. 해당 feature의 Rules에서 subfeature, 구현 방식, 파라미터를 조절한다. 필요한 카드만 재생성하거나 불필요한 카드·위젯을 삭제한다.
5. 코드를 생성해 해당 스케치의 별도 결과 프레임에서 p5.js 결과를 확인한다. 여러 스케치의 결과를 동시에 볼 수 있으며, 연결된 위젯을 조절하면 해당 코드와 결과가 함께 바뀐다.
6. Feature를 procedural brush로도 생성할 수 있다. 설명을 추가해 원하는 브러시를 만들고 스케치에 사용한다.
   또는 Rule의 Make pen으로 semantic을 담은 색 연필을 추가해 다른 펜·Pencil과 자유롭게 스케치하고, Compose prompt로 자국들을 해석해 결과를 생성한다.
7. 생성 결과 위에 자유롭게 annotation 스케치를 하고, AI가 자동으로 작성한 Text clarification을 확인하거나 수정한다.
8. 그 설명을 바탕으로 기존 rule·visual feature 변경 또는 새 항목 추가 제안을 검토하고, Confirm으로 실제 규칙·코드·결과에 적용한다.


---

# V2 변경 사항 — 현재 적용할 요구사항

## 16. Visual feature → 세 종류의 rule widget

- 이미지·스케치에서 visual feature를 추출한 뒤 rule을 생성하는 단계에서, 위젯을 **Spatial constraint / Stylistic constraint / Object**로 구분해 생성한다. Temporal constraint는 일단 제외한다.
- 추출되는 constraint와 object는 모든 feature를 합쳐 최대 7개로 제한한다.
- 각 위젯에는 종류를 표시한다. 기존 subfeature·구현 방식·파라미터 정보는 위젯의 종류와 독립적인 알고리즘 데이터에 연결한다.
- Feature 선택에 따른 필터, 텍스트 편집, 재생성, 파라미터 조절은 유지한다. 기존 Rules 탭은 Constraints 탭으로 표시한다.

| 종류 | 의미 | 적용 대상 |
| --- | --- | --- |
| Spatial constraint | 특별한 공간 규칙·constraint를 적용하는 group | 안에 포함된 object와 하위 spatial group |
| Stylistic constraint | 색·선·질감 등의 표현을 정의하는 constraint | 지정한 object 또는 spatial group |
| Object | constraint에 의해 조절되는 primitive entity | ellipse, rectangle, triangle, line, procedural path |

- Spatial constraint는 단순한 시각적 영역 표시가 아니라 object를 포함하고 조절하는 group이다.
- Object는 constraint와 별개로 존재하며, 포함 관계 또는 target 연결에 의해 constraint의 영향을 받는다.
- Spatial group의 중첩을 지원하고, 포함 관계에 순환이 생기지 않도록 한다. Group에 적용된 constraint는 그 안의 object에도 전달한다.

## 17. 위젯과 알고리즘의 분리·재사용

- 위젯 안에 들어가는 알고리즘을 독립 데이터로 분리한다. 위젯은 알고리즘을 참조하고, 알고리즘은 별도 라이브러리에 보관한다.
- Constraint에는 하나 이상의 알고리즘을 연결할 수 있다. Object 자체는 primitive entity로 유지하고 constraint에 연결된 알고리즘으로 조절한다. Object의 고유 형태·윤곽 정의는 별도의 알고리즘 참조로 보관한다.
- 알고리즘을 현재 constraint에서 분리(detach)할 수 있어야 한다. 분리된 알고리즘과 그 파라미터는 라이브러리에 남는다.
- 분리하거나 기존 라이브러리에 있는 알고리즘을 다른 constraint에 끼워 넣을 수 있어야 한다. Drag/drop과 선택한 constraint에 연결하는 조작을 제공한다.
- 알고리즘을 다른 constraint로 이동하거나 여러 constraint에서 공유할 수 있어야 한다.
- 같은 알고리즘을 공유하면 해당 알고리즘의 파라미터 편집이 연결된 constraint들에 함께 반영된다.
- 알고리즘을 분리·이동·연결하면 영향을 받는 constraint의 결과 코드 연결도 갱신한다. 다른 스케치의 결과는 독립적으로 유지한다.

## 18. 알고리즘 펜·Compose를 direct manipulation으로 대체

- 기존 **Make pen → 알고리즘 의미를 가진 펜으로 스케치 → Compose prompt / Compose sketch** 흐름을 제거한다. 기존 14번과 주요 사용 흐름 6번의 알고리즘 펜 대안은 현재 workflow에 적용하지 않는다.
- 일반 Pencil은 원본 그림을 그리는 도구로 유지한다. 알고리즘을 펜 자국에 담아 합성하는 방식은 사용하지 않는다.
- 새 흐름은 **Visual feature 분석 → typed widget 생성 → constraint 안에 알고리즘 연결 → 스케치 프레임에서 direct manipulation → result frame 코드 생성·갱신**이다.
- Constraints 탭 및 조작 도구에서 스케치 프레임의 object·constraint를 선택하고 직접 이동한다. Constraint는 move만 제공하고 object의 크기 조절은 유지한다.
- Spatial constraint를 이동하면 포함된 object도 크기를 유지한 채 함께 이동한다.
- Object·constraint의 위치, object의 크기 및 연결된 알고리즘 파라미터를 result 코드와 연결한다. 코드 생성 후 이러한 값의 변경은 AI 호출 없이 코드·p5.js 결과를 갱신한다.
- 처음에는 **Reconstruct sketch**로 원본 이미지와 scene을 코드로 만든다. 다른 스케치에 추출 위젯을 드롭하면 첫 결과도 자동으로 생성한다. 이후 object 추가·삭제, constraint 포함·target 관계 변경, 알고리즘 연결·분리 등의 구조 변경은 코드를 자동으로 다시 생성한다.
- 결과 프레임은 연결된 스케치의 scene만 반영한다. 실행 결과 annotation → clarification → suggestion → Confirm 흐름은 유지하며, 수정 제안에도 현재 constraint·object·알고리즘 관계를 전달한다.
- 이전 프로젝트의 데이터는 불러올 수 있게 유지한다. 기존 rule의 선택한 구현 방식은 독립 알고리즘과 typed scene으로 복원하고, 오래된 semantic stroke는 원본 입력 자료로 보존한다.

## 19. Object·constraint의 drag/drop과 자동 적용

- 팔레트의 object·spatial·stylistic constraint를 스케치 프레임으로 drag/drop해 배치할 수 있어야 한다.
- 이미 생성된 위젯도 스케치 프레임에서 재배치할 수 있어야 한다. 다른 스케치로 드롭하면 해당 위젯과 필요한 알고리즘·하위 object를 복사하고 원래 스케치를 유지한다.
- Object를 spatial constraint 안으로 드롭하거나 이동해 넣으면 그 group의 object가 되고, **해당 constraint와 연결된 알고리즘이 자동으로 적용**된다.
- Object를 group 밖으로 옮기면 포함 관계를 갱신하고, 실제 관계에 맞춰 constraint 적용 대상을 다시 계산한다.
- Stylistic constraint는 대상 object·spatial group을 연결해 적용한다. 대상 위에 constraint를 드롭하는 방식과 target 선택을 지원한다.
- 드롭 위치와 적용 대상 constraint를 시각적으로 표시한다.
- Direct manipulation의 Undo/Redo를 지원한다. Scene의 포함·target 관계와 알고리즘 연결·파라미터는 스케치별 저장·내보내기·불러오기에 포함한다.

## 20. 스케치 프레임 삭제

- 원본 프레임과 추가 프레임 모두 헤더의 삭제 버튼으로 삭제할 수 있어야 한다. 내용만 지우는 Clear canvas와 프레임 삭제는 구분한다.
- 스케치 프레임을 삭제하면 연결된 generated result 프레임도 함께 제거한다.
- 삭제한 프레임의 그림·사진, visual feature, rule·constraint·object, 독립 알고리즘, 코드, 패널 상태, annotation 초안과 Undo/Redo 기록을 정리한다.
- 삭제한 프레임의 진행 중 요청이 삭제된 데이터를 다시 복원하지 않도록 한다. 다른 프레임의 그림·규칙·코드·결과는 유지한다.
- 선택한 프레임을 삭제하면 남아 있는 스케치를 선택한다. 모든 스케치 프레임을 삭제하는 것도 허용하고, 빈 작업 공간에서 새 프레임을 추가할 수 있어야 한다.
- 프레임 삭제 상태를 로컬 저장과 프로젝트 JSON에 반영한다. 새로고침·불러오기 후 삭제한 프레임이나 그 결과가 다시 나타나지 않도록 한다.

## 21. AI 로그 요구사항의 V2 반영

- 기존 15번의 모든 AI 요청 기록 요구사항은 유지한다. 새 constraint scene 코드 생성과 구조 변경에 따른 재생성도 입력 scene·적용 관계·prompt·응답·코드를 기록한다.
- 현재 UI에서 제거한 Compose 관련 요청은 새 workflow에서 발생하지 않는다. 이전 로그와 데이터의 호환성은 유지한다.
- 위젯 이동, object 리사이즈, 연결된 파라미터 값 변경, 프레임 삭제 등 AI를 호출하지 않는 로컬 조작은 AI 생성 로그에 포함하지 않는다.

## V2 주요 사용 흐름

1. 스케치 프레임을 추가·선택해 그림을 그리거나 사진을 첨부·붙여넣기 한다.
2. 전체 이미지 또는 라쏘 영역을 분석하고 visual feature를 선택한다.
3. **Generate widgets**로 spatial·stylistic constraint와 object를 합계 최대 7개 생성한다.
4. 팔레트나 생성된 위젯을 스케치 프레임에 drag/drop한다. Object를 spatial constraint 안에 넣어 그 constraint를 자동 적용한다.
5. Constraint 안에 알고리즘을 연결한다. 필요하면 분리해서 다른 constraint에 끼우거나 공유한다.
6. Object·constraint를 직접 이동하고, object 크기·target·알고리즘 파라미터를 조절한다. Constraint 크기 조절은 제공하지 않는다.
7. **Reconstruct sketch**로 연결된 result frame에서 원본을 재구성한 p5.js 결과를 확인한다. 생성 후 값 변경은 즉시 반영하고, scene 구조 변경과 다른 프레임으로의 추출 위젯 복사는 코드를 자동 갱신한다.
8. 필요하면 procedural brush를 만들거나 결과 위 annotation으로 AI 수정 제안을 검토·적용한다.
9. 불필요한 스케치 프레임은 삭제한다. 다른 스케치와 결과는 유지한다.
10. 프로젝트를 로컬 저장하거나 JSON으로 내보내고, 다시 불러와 scene·알고리즘·프레임 삭제 상태를 이어서 작업한다.


## 22. Reconstruction 유지·위젯 이동 수정 (2026-10-07)

- 위젯을 종류별로 분리한 뒤에도 **스케치/사진 → visual feature → constraint/object 추출 → 원본 reconstruction**을 그대로 지원한다. 초기 파라미터로 원본의 형태·비율·배치·반복·색·배경·질감을 재구성하고, 일반적인 기본 도형 배열로 대체하지 않는다.
- Constraint 추출에는 원본 이미지도 전달한다. Object는 필요한 곡선·윤곽을 표현하는 procedural path도 포함할 수 있다.
- 추출한 위젯에 원본 feature 설명·원래 영역·이미지 참조를 보관하고 저장한다. 다른 프레임으로 드래그해도 이 정보와 형태 알고리즘, 관련 stylistic constraint, object 포함 관계를 함께 유지한다.
- 빈 스케치로 옮긴 추출 위젯은 첫 result도 자동으로 reconstruction한다. 기존 결과를 보존하면서 구조 변경에 맞춰 갱신한다.
- 실행 가능한 코드의 실제 AI reconstruction 품질은 원본 이미지와 결과를 비교해 검증한다.

## 23. 태그 가독성과 선택 강조 복원

- 확대해도 constraint 태그가 흐릿해지지 않도록 화면 크기에 맞게 선명하게 렌더링한다.
- Constraint/object 태그 하나를 선택하면 그 태그·영역·연결선은 명확하게 유지하고, 다른 태그·영역·연결선은 거의 투명하게(4%) 표시한다. 선택 해제 또는 Escape로 전체 표시를 복원한다.

## 24. 현재 적용할 범위: 세 종류·총 7개·constraint 이동만

아래 항목은 앞선 16~21번의 종류·리사이즈 요구사항을 수정하는 최신 요구사항이다.

- **Temporal constraint는 일단 제외한다.** 현재 추출과 팔레트에는 **Spatial constraint / Stylistic constraint / Object** 세 종류만 제공한다. 기존 프로젝트의 temporal 위젯도 현재 조작 scene에서는 제외한다.
- 이미지에서 추출하는 constraint와 object는 **모든 visual feature를 합쳐 최대 7개**로 제한한다. Feature마다 별도의 object/group을 불필요하게 중복 생성하지 않고 관계를 공유한다.
- **Constraint의 direct manipulation은 move만 제공한다.** Constraint 크기 조절 핸들은 제거한다. Spatial constraint를 이동하면 안의 object도 크기를 유지한 채 함께 이동한다.
- Object를 constraint 안에 넣는 동작에서 object나 constraint 크기를 임의로 줄이지 않는다. Object 자체의 기본 도형 크기 조절은 유지한다.
- Reconstruction 버튼 이름은 **Reconstruct sketch**로 표시한다. Object 없이 constraint만 있는 scene을 빈 결과로 생성하지 않고 object가 필요하다고 안내한다.

- Object의 intrinsic primitive/contour 정의도 독립 알고리즘으로 유지한다. 정의 파라미터는 해당 object에서 조절하며 다른 constraint에 재사용할 수 있다. 원본에서 독립된 배경 object는 반복 group에 임의로 포함하거나 그 group의 복사에 따라오게 하지 않는다.
