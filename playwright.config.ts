import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'webui_commerce.spec.ts',timeout:120_000,workers:1,use:{viewport:{width:1500,height:960},headless:true},reporter:'list'});
