const service = require('../services/mesero.service');
const schema = require('../models/mesero.model');
const { handle } = require('../utils/handle');

const AddWaiter = handle('No se pudo completar la acción.', async (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).send(error.message);
  value.tenantId = req.tenantId;
  if (await service.GetWaiterByCellphone(value.cellphone, req.tenantId)) {
    return res.status(400).send('Mesero ya existe');
  }
  await service.AddWaiter(value);
  const created = await service.GetWaiterByCellphone(value.cellphone, req.tenantId);
  return res.status(201).send(created);
});

const GetWaiters = handle('No se pudo completar la acción.', async (req, res) => {
  const result = await service.GetWaiters(req.tenantId);
  return res.status(200).send(result);
});

const GetWaiterByCellphone = handle('No se pudo completar la acción.', async (req, res) => {
  const result = await service.GetWaiterByCellphone(req.params.cellphone, req.tenantId);
  if (!result) return res.status(404).send('Mesero no encontrado');
  return res.status(200).send(result);
});

const GetWaiterByDisponibility = handle('No se pudo completar la acción.', async (req, res) => {
  const result = await service.GetWaiterByDisponibility(
    req.params.disponibility,
    req.tenantId
  );
  if (!result) return res.status(404).send('Mesero no encontrado');
  return res.status(200).send(result);
});

const DeleteWaiter = handle('No se pudo completar la acción.', async (req, res) => {
  const result = await service.DeleteWaiter(req.params.cellphone, req.tenantId);
  if (!result) return res.status(404).send('Mesero no encontrado');
  return res.status(200).send(result);
});

const UpdateWaiter = handle('No se pudo completar la acción.', async (req, res) => {
  const result = await service.UpdateWaiter(
    req.params.cellphone,
    req.body,
    req.tenantId
  );
  if (!result) return res.status(404).send('Mesero no encontrado');
  return res.status(200).send('Mesero actualizado');
});

module.exports = {
  AddWaiter,
  GetWaiters,
  GetWaiterByCellphone,
  GetWaiterByDisponibility,
  DeleteWaiter,
  UpdateWaiter,
};
