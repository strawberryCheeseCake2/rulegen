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
  


