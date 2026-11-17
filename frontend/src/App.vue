<template>
  <router-view></router-view>
  <BrandLoader />
</template>

<script>
import BrandLoader from './components/BrandLoader.vue'

export default {
  name: 'App',
  components: { BrandLoader }
}
</script>

<style>
/* Estilos para tu aplicación */
</style>
