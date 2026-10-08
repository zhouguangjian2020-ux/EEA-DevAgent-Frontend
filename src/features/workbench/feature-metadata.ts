import { newerVersion } from "../metadata/model";
import type { BusinessFeature, ObjectWork, ProjectWorks } from "./model";

// Metadata synchronization only: immutable document bodies and unsaved content stay untouched.
export function synchronizeFeature(p: ProjectWorks, incoming: BusinessFeature): ProjectWorks {
  const old = p.features[incoming.id];
  if (!newerVersion(incoming.lockVersion, old?.lockVersion)) return p;
  const feature = { ...old, ...incoming };
  const objectIds = new Set(Object.values(p.works).filter(w => w.featureId === feature.id).flatMap(w => [w.id, ...(w.database ? [w.database.artifactId] : []), ...("objectId" in w ? [w.objectId] : []), ...("document" in w.session && w.session.document ? [w.session.document.id] : [])]));
  const labels = (items: ObjectWork["attachments"]) => items.map(a => objectIds.has(a.id) ? { ...a, functionName: feature.name } : a);
  const works = Object.fromEntries(Object.entries(p.works).map(([id, work]) => {
    let next = { ...work, attachments: labels(work.attachments) } as ObjectWork;
    if (work.featureId === feature.id) {
      next = { ...next, featureName: feature.name, session: { ...next.session, rootName: feature.name } } as ObjectWork;
      if (next.kind === "PRD" && next.session.document) next = { ...next, session: { ...next.session, document: { ...next.session.document, functionName: feature.name } } };
      else if ((next.kind === "UC" || next.kind === "FR") && next.session.document) next = { ...next, session: { ...next.session, document: { ...next.session.document, featureName: feature.name } } } as ObjectWork;
    }
    return [id, next];
  }));
  return { ...p, features: { ...p.features, [feature.id]: feature }, works, conversation: { ...p.conversation, attachments: labels(p.conversation.attachments) } };
}
