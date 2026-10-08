import { createPrdSession, transitionPrd } from "../features/prd/model";
import { createUcSession } from "../features/uc/model";
import type { ObjectWork, PrdWork } from "../features/workbench/model";
import { generateMockPrd } from "./prd";
import { createMockUc } from "./uc";

export function demoWorks(project: string): { works: ObjectWork[]; openId: string } {
  function prd(name: string, suffix: string, accepted = false): PrdWork {
    const id = `${project}-demo-prd-${suffix}`;
    const document = generateMockPrd(project, `生成${name}的产品需求文档`, null, id, name);
    let session = transitionPrd(createPrdSession(), { type: "start", request: { id, kind: "generate", prompt: `生成${name}的产品需求文档`, previous: null } });
    session = transitionPrd(session, { type: "generated", id, document });
    if (accepted) session = transitionPrd(session, { type: "accept" });
    return { id, kind: "PRD", featureId: `${project}-demo-feature-${suffix}`, featureName: name, attachments: [], session, ucTask: null };
  }
  const aeb = prd("自动紧急制动 AEB", "aeb");
  const lock = prd("儿童锁", "childlock", true);
  const works: ObjectWork[] = [aeb, lock];
  for (let i = 0; i < 5; i++) {
    const document = createMockUc(project, lock.featureName, lock.id, i, true);
    works.push({ id: document.id, kind: "UC", featureId: lock.featureId, featureName: lock.featureName, attachments: [], session: createUcSession(document), objectId: document.id, number: document.content.number, originalName: document.content.name, sourcePrdWorkId: lock.id });
  }
  return { works, openId: works.at(-1)!.id };
}
