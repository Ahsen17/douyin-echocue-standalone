import { OverlayPreview } from './ConfigPages';

/** 仅用于原型审查；正式产品中此窗口由 Electron 独立创建，不属于主窗口导航。 */
export function OverlayPage() {
  return <div className="overlay-stage">
    <div><h1>直播浮窗</h1><p>独立窗口预览：始终置顶、收到新建议时显示，默认展示 10 秒；展示期不生成、不排队。</p></div>
    <OverlayPreview />
  </div>;
}
