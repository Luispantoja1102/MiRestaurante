<template>
  <router-view></router-view>
  <BrandLoader />
  <DialogHost />
</template>

<script>
import BrandLoader from './components/BrandLoader.vue'
import DialogHost from './components/DialogHost.vue'

export default {
  name: 'App',
  components: { BrandLoader, DialogHost }
}
</script>

<style>
/* Estilos para tu aplicación */
</style>
