const schema = require('../models/usuario.model');
const service = require('../services/usuario.service');
const hasher = require('../utils/bcrypt.utils');
const waitlist = require('../models/waitlist.model');
const jwtCreator = require('../utils/jwt.utils');
const db = require('../database/mongodb');
const { createTenantDoc, newResetToken, ROLES } = require('../models/tenant.model');
const { sendPasswordResetEmail } = require('../utils/mail.utils');
const { normalizeRole, isOutsideTenant } = require('../models/roles');
const referrals = require('../services/referral.service');

const CreateUser = async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).send(error.message);
    }
    if (await service.FindUserByUsername(value.username)) {
      return res.status(400).send('Usuario con el nombre de usuario ya registrado');
    }
    if (await service.FindUserByEmail(value.email)) {
      return res.status(400).send('Usuario con el correo ya registrado');
    }

    // El código de vendedor se valida antes de crear nada: uno inválido no debe dejar un negocio a medias
    let referrer = null;
    try {
      referrer = await referrals.resolveForSignup(value.referralCode, { email: value.email });
    } catch (err) {
      if (err instanceof referrals.ReferralError) return res.status(err.status).send(err.message);
      throw err;
    }

    const tenant = await db.CreateTenant({
      ...createTenantDoc(value.businessName || `${value.name} ${value.lastName}`),
      ...(referrer ? referrals.referralFields(referrer) : {}),
    });
    const tenantId = tenant.id;

    value.password = await hasher.hashPassword(value.password);
    value.role = 'admin';
    value.tenantId = tenantId;
    delete value.businessName;
    delete value.referralCode;

    await service.CreateUser(value);

    await db.CreateSettings({
      tenantId,
      businessName: tenant.name,
      businessType: 'restaurant',
      address: '',
      phone: value.cellphone || '',
      logoUrl: '/logo.svg',
      timezone: 'America/Mexico_City',
      initialTables: 8,
      setupCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = jwtCreator.generateJWT({
      userId: value.username,
      userRole: 'admin',
      tenantId,
    });

    return res.status(201).json({
      message: 'Usuario creado con exito',
      token,
      role: 'admin',
      tenantId,
      username: value.username,
    });
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

/** Cambiar mi propia contraseña (cualquier cuenta con sesión): pide la actual para confirmar que soy yo. */
const ChangePassword = async (req, res) => {
  try {
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    const user = await db.FindUserByUsername(req.user.username, req.tenantId);
    if (!user) return res.status(404).send('Usuario no encontrado');
    if (!current || !(await hasher.checkPassword(current, user.password))) {
      return res.status(400).send('La contraseña actual no es correcta.');
    }
    if (next.length < 8) return res.status(400).send('La nueva contraseña debe tener al menos 8 caracteres.');
    if (next === current) return res.status(400).send('La nueva contraseña debe ser distinta a la actual.');
    if (next.toLowerCase().includes(String(user.username).toLowerCase())) {
      return res.status(400).send('La contraseña no puede contener tu usuario.');
    }
    await db.UpdateUserById(String(user._id), { password: await hasher.hashPassword(next), updatedAt: new Date() });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send('No pude cambiar la contraseña. Intenta de nuevo.');
  }
};

/** Pública: el registro la usa para decir «código válido» antes de enviar el formulario. */
const CheckReferralCode = async (req, res) => {
  try {
    const ref = await referrals.findActiveByCode(req.params.code);
    return res.status(200).json(ref ? { valid: true, code: ref.code, seller: ref.name } : { valid: false });
  } catch (err) {
    console.error(err);
    return res.status(500).send('No pude revisar el código.');
  }
};

const FindUserByEmail = async (req, res) => {
  try {
    const search = await service.FindUserByEmail(req.body.email);
    if (search) return res.status(200).send(search);
    return res.status(404).send('Usuario no encontrado');
  } catch (error) {
    return res.status(500).send(error);
  }
};

const LoginUsuario = async (req, res, next) => {
  try {
    const search = await service.LoginUsuario(req.body.data);
    if (search) {
      const compare = await hasher.checkPassword(req.body.password, search.password);
      if (compare) {
        const role = normalizeRole(search.role);
        if (search.disabled) return res.status(403).send('Esta cuenta está desactivada.');
        if (!isOutsideTenant(role) && !search.tenantId) {
          return res.status(403).send('Usuario sin tenant asignado');
        }
        // Para "última vez visto" en la plataforma; un fallo aquí nunca debe impedir entrar
        db.UpdateUserById(search._id, { lastLoginAt: new Date() }).catch(() => {});
        const token = jwtCreator.generateJWT({
          userId: search.username,
          userRole: role,
          tenantId: search.tenantId || null,
        });
        req.token = token;
        req.role = role;
        req.tenantId = search.tenantId || null;
        req.username = search.username;
        return next();
      }
    }
    return res.status(404).send('Correo o contraseña incorrecta');
  } catch (error) {
    console.error(error.message);
    return res.status(500).send(error.message);
  }
};

const FindUserByUsername = async (req, res) => {
  try {
    const search = await service.FindUserByUsername(req.body.username);
    if (search) return res.status(200).send(search);
    return res.status(404).send('Usuario no encontrado');
  } catch (err) {
    console.error(err);
    return res.status(500).send(err);
  }
};

const FindWaiters = async (req, res) => {
  try {
    const search = await db.GetWaiters(req.tenantId);
    return res.status(200).send(search || []);
  } catch (err) {
    console.error(err.message);
    return res.status(500).send(err.message);
  }
};

const GetWaitList = async (req, res) => {
  try {
    const Search = await db.GetWaitList(req.tenantId);
    return res.status(200).send(Search);
  } catch (exp) {
    console.error(exp.message);
    return res.status(500).send(exp);
  }
};

const DeleteWaitList = async (req, res) => {
  try {
    const result = await db.DeleteWaitList(req.params.id, req.tenantId);
    return res.status(200).send(result);
  } catch (exp) {
    console.error(exp.message);
    return res.status(500).send(exp);
  }
};

const AddWaitList = async (req, res) => {
  try {
    const { error, value } = waitlist.validate(req.body);
    if (error) return res.status(400).send(error.message);
    value.tenantId = req.tenantId;
    await db.AddWaitList(value);
    return res.status(200).send('Añadido a la wait list');
  } catch (exp) {
    console.error(exp.message);
    return res.status(500).send(exp);
  }
};

const ForgotPassword = async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).send('Email requerido');

    const user = await db.FindUserByEmail(email);
    if (!user) {
      return res.status(200).json({ ok: true, message: 'Si el correo existe, enviamos un enlace' });
    }

    const token = newResetToken();
    await db.UpdateUserById(String(user._id), {
      resetToken: token,
      resetExpires: new Date(Date.now() + 60 * 60 * 1000),
    });

    const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
    const resetUrl = `${appUrl}/reset/${token}`;
    const mail = await sendPasswordResetEmail({ to: email, resetUrl });

    return res.status(200).json({
      ok: true,
      message: 'Si el correo existe, enviamos un enlace',
      mail,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al solicitar restablecimiento');
  }
};

const ResetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 6) {
      return res.status(400).send('Token y contraseña (mín. 6) requeridos');
    }
    const user = await db.FindUserByResetToken(token);
    if (!user) return res.status(400).send('Token inválido o expirado');

    const hashed = await hasher.hashPassword(password);
    await db.UpdateUserById(String(user._id), {
      password: hashed,
      resetToken: null,
      resetExpires: null,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al restablecer contraseña');
  }
};

const Me = async (req, res) => {
  let user = null;
  try {
    user = await db.FindUserByUsername(req.user.username, req.tenantId);
  } catch {
    // Sin datos extra el resto de /me sigue sirviendo
  }
  return res.status(200).json({
    username: req.user.username,
    role: req.user.role,
    tenantId: req.tenantId,
    roles: ROLES,
    name: user?.name || '',
    lastName: user?.lastName || '',
    cellphone: user?.cellphone || '',
  });
};

module.exports = {
  CreateUser,
  ChangePassword,
  CheckReferralCode,
  FindUserByEmail,
  LoginUsuario,
  FindUserByUsername,
  FindWaiters,
  GetWaitList,
  DeleteWaitList,
  AddWaitList,
  ForgotPassword,
  ResetPassword,
  Me,
};
