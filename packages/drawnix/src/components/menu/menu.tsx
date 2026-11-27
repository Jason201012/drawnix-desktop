import { Island } from '../island';
import React, { useContext, useState } from 'react';
import { MenuContentPropsContext } from './common';
import classNames from 'classnames';
import './menu.scss';

const Menu = ({
  children,
  className = '',
  onSelect,
  style,
  containerStyle,
  container,
}: {
  children?: React.ReactNode;
  className?: string;
  /**
   * Called when any menu item is selected (clicked on).
   */
  onSelect?: (event: Event) => void;
  style?: React.CSSProperties;
  containerStyle?: React.CSSProperties;
  container?: HTMLElement | null;
}) => {
  const parent = useContext(MenuContentPropsContext);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const newClassName = classNames(`menu ${className}`).trim();

  return (
    <MenuContentPropsContext.Provider
      value={{ onSelect, container: root ?? container ?? parent.container }}
    >
      <div ref={setRoot} className={newClassName} style={style} data-testid="menu">
        {
          <Island className="menu-container" padding={2} style={containerStyle}>
            {children}
          </Island>
        }
      </div>
    </MenuContentPropsContext.Provider>
  );
};
Menu.displayName = 'Menu';

export default Menu;
