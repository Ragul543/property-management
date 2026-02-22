/** @odoo-module **/

import { url } from '@web/core/utils/urls';
import { useService } from '@web/core/utils/hooks';

import { Component, onWillUnmount, onMounted, useState } from '@odoo/owl';

export class AppsBar extends Component {
	static template = 'muk_web_appsbar.AppsBar';
    static props = {};
	setup() {
		this.companyService = useService('company');
        this.appMenuService = useService('app_menu');
        this.state = useState({
            collapsed: localStorage.getItem('mk_sidebar_collapsed') === 'true',
        });
    	if (this.companyService.currentCompany.has_appsbar_image) {
            this.sidebarImageUrl = url('/web/image', {
                model: 'res.company',
                field: 'appbar_image',
                id: this.companyService.currentCompany.id,
            });
    	}
    	const renderAfterMenuChange = () => {
            this.render();
        };
        this.env.bus.addEventListener(
        	'MENUS:APP-CHANGED', renderAfterMenuChange
        );
        onWillUnmount(() => {
            this.env.bus.removeEventListener(
            	'MENUS:APP-CHANGED', renderAfterMenuChange
            );
        });
        onMounted(() => {
            this._applySidebarState();
        });
    }
    toggleSidebar() {
        this.state.collapsed = !this.state.collapsed;
        localStorage.setItem('mk_sidebar_collapsed', this.state.collapsed);
        this._applySidebarState();
    }
    _applySidebarState() {
        const body = document.body;
        if (this.state.collapsed) {
            body.classList.add('mk_sidebar_collapsed');
        } else {
            body.classList.remove('mk_sidebar_collapsed');
        }
    }
}
