import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app/app.component';
import { ROUTES } from './app/routes';
import { centreAndToken } from './app/shell/api.interceptor';
import { restoreSession } from './app/shell/restore';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([centreAndToken])),
    // Before the router decides anything: a guard that asks what this account
    // may do while the account is still being fetched answers on nothing.
    provideAppInitializer(restoreSession),
    provideRouter(ROUTES),
  ],
}).catch((error) => console.error(error));
