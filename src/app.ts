import { ApplicationCoordinator } from "./app/application-coordinator";
import { createAutoscheduleStore } from "./app/store/autoschedule-store";
import type { AutoscheduleAppElement } from "./ui/components/autoschedule-app";
import "./ui/components/autoschedule-app";

export interface MountedAutoscheduleApp {
  dispose(): void;
}

export function mountAutoscheduleApp(
  root: HTMLElement
): MountedAutoscheduleApp {
  const store = createAutoscheduleStore();
  const element: AutoscheduleAppElement =
    document.createElement("autoschedule-app");
  const coordinator = new ApplicationCoordinator(store, {
    onViewChange: (view) => {
      element.view = view;
    },
  });
  element.commandHandler = coordinator;
  element.model = store.getState().model;
  const unsubscribe = store.subscribe((state) => {
    element.model = state.model;
  });
  root.replaceChildren(element);
  coordinator.start();
  return {
    dispose: () => {
      unsubscribe();
      element.remove();
    },
  };
}
